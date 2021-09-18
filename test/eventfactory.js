const EventFactory = artifacts.require("EventFactory");
const Ticket = artifacts.require("Ticket");

const chai = require('chai');
const BN = require('bn.js');
const truffleAssert = require('truffle-assertions');

// Enable and inject BN dependency
chai.use(require('chai-bn')(BN));
chai.should()

const getCurrentBlockTimestamp = async () => {
  return web3.eth.getBlockNumber().then(blocknumber => web3.eth.getBlock(blocknumber)).then(result => { return result.timestamp });
}

const getSignature = async (_msg, _owner) => {
  return web3.eth.sign(_msg, _owner).then(signature => {
    var _r = signature.slice(0, 66);
    var _s = "0x" + signature.slice(66, 130);
    var _v = "0x" + signature.slice(130, 132);
    _v = web3.utils.hexToNumber(_v);

    return {r: _r, s: _s, v: _v};
  });
}

const timeout = (ms) =>{
  return new Promise(resolve => setTimeout(resolve, ms));
}

var testTicketStruct;

var testTicketStruct2;

contract('EventFactory', (accounts) => {

  const uri = "https://www.testimguri.com/asdasd.png"
  let owner       = accounts[0];
  let nonOwner    = accounts[1];
  var eventId;
  var ticketAddress;

  it('creating an event should emit EventCreate event and return metadata correctly', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    console.log("    INFO: EventFactory instance address: " + eventFactoryInstance.address);

    const currentTimestamp = await getCurrentBlockTimestamp();

    const testEventStruct = [
      currentTimestamp + 60, 
      currentTimestamp + 65];

    const tx = await eventFactoryInstance.createEvent(testEventStruct, {from: owner});

    assert.equal(tx.logs.length, 1, "No EventCreate event emitted!");

    eventId = tx.logs[0].args.eventId.valueOf();

    console.log("    INFO: EventId: " + eventId.toString(16));

    const eventMetadata = await eventFactoryInstance.eventToMetadata(eventId);

    console.log("    INFO: Gas used for event creation: " + tx.receipt.gasUsed);

    for (let i = 0; i < testEventStruct.length; i++) {
      assert.equal(eventMetadata[i], testEventStruct[i], "Wrong event metadata saved to blockchain!");
    }
  });

  it('creating a ticket should emit TicketCreate event and return metadata correctly', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestampForTestStruct = await getCurrentBlockTimestamp();
    testTicketStruct = [10, 100000, currentTimestampForTestStruct, currentTimestampForTestStruct + 1000000, false];

    const tx2 = await eventFactoryInstance.createTicket(eventId, uri, testTicketStruct, {from: owner});

    console.log("    INFO: Gas used for ticket creation: " + tx2.receipt.gasUsed);

    assert.equal(tx2.logs.length, 1, "No TicketCreate event emitted!");
    assert.equal(tx2.logs[0].args.ownerAddress.valueOf(), owner, "Wrong owner address issued for ticket!");

    tx2.logs[0].args.eventId.valueOf().should.be.a.bignumber.that.equals(eventId);

    ticketAddress = tx2.logs[0].args.ticketAddress.valueOf();

    console.log("    INFO: Ticket instance address: " + ticketAddress);

    const ticketGAInstance = await Ticket.at(ticketAddress);
    const ticketMetadata = await ticketGAInstance.metadata();

    for (let i = 0; i < testTicketStruct.length; i++) {
      assert.equal(ticketMetadata[i], testTicketStruct[i], "Wrong ticket metadata saved to blockchain!");
    }
  });

  it('creating a ticket from non-owner address should revert', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestampForTestStruct = await getCurrentBlockTimestamp();
    testTicketStruct2 = [10, 5000000, currentTimestampForTestStruct, currentTimestampForTestStruct + 1000000, false];

    await truffleAssert.reverts(eventFactoryInstance.createTicket(eventId, uri, testTicketStruct2, {from: nonOwner}));
  });

  var ticketMintedIdStart;
  const numTicketsMinted = 7;

  it('minting a ticket should take payment and add to balance', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const ticketGAInstance = await Ticket.at(ticketAddress);

    let ticketPurchaserStartingBalance = await web3.eth.getBalance(nonOwner);
    const ticketPurchaserStartingBalanceBN = new BN(ticketPurchaserStartingBalance);
    const ticketPurchaserStartingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();
    const ticketContractStartingBalance = parseInt(await web3.eth.getBalance(ticketAddress));
    
    const tx4 = await ticketGAInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: numTicketsMinted * testTicketStruct[1]});

    assert.equal(tx4.logs.length, numTicketsMinted + 1, "No TicketMint event emitted!");
    ticketMintedIdStart = tx4.logs[numTicketsMinted].args.ticketStartId.valueOf();
    console.log("    INFO: Gas used for minting 7 tickets: " + tx4.receipt.gasUsed);

    const gasUsedBN = new BN(tx4.receipt.gasUsed);
    const txRaw = await web3.eth.getTransaction(tx4.tx);
    const gasPriceBN = new BN(txRaw.gasPrice);
    const transactionFee = gasPriceBN.mul(gasUsedBN);
    const ticketCosts = new BN(numTicketsMinted * testTicketStruct[1]);
    const diffBalance = transactionFee.add(ticketCosts);

    let ticketPurchaserEndingBalance = await web3.eth.getBalance(nonOwner);
    const ticketPurchaserEndingBalanceBN = new BN(ticketPurchaserEndingBalance);
    const ticketPurchaserEndingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();

    ticketPurchaserEndingBalanceBN.should.be.a.bignumber.that.equals(ticketPurchaserStartingBalanceBN.sub(diffBalance));

    assert.equal(ticketPurchaserStartingTickets + 7, ticketPurchaserEndingTickets, "Wrong number of tickets issued to ticket purchaser!");

    const ticketContractEndingBalance = parseInt(await web3.eth.getBalance(ticketAddress));
    assert.equal(numTicketsMinted * testTicketStruct[1], ticketContractEndingBalance - ticketContractStartingBalance, "Wrong balance sent to Ticket smart contract!");

    let nonOwnerTotalTickets = await eventFactoryInstance.getTotalTicketsOfSender({from: nonOwner});
    assert.equal(nonOwnerTotalTickets, 1);
  });

  it('minting a ticket with incorrect funds should revert', async () => {
    const ticketGAInstance = await Ticket.at(ticketAddress);

    const ticketPurchaserStartingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();
    
    await truffleAssert.reverts(ticketGAInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: (numTicketsMinted - 1) * testTicketStruct[1]})); // funds sent for one less ticket than ordered
    await truffleAssert.reverts(ticketGAInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: (numTicketsMinted + 1) * testTicketStruct[1]})); // funds sent for one more ticket than ordered

    const ticketPurchaserEndingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();

    assert.equal(ticketPurchaserStartingTickets, ticketPurchaserEndingTickets, "Tickets still issued even if reverted!");
  });

  it('minting a ticket above max ticket count should revert', async () => {
    const ticketGAInstance = await Ticket.at(ticketAddress);

    const ticketPurchaserStartingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();
    
    await truffleAssert.reverts(ticketGAInstance.mintTicket(numTicketsMinted * 10, {from: nonOwner, value: numTicketsMinted * testTicketStruct[1]})); // funds sent for one less ticket than ordered

    const ticketPurchaserEndingTickets = (await ticketGAInstance.balanceOf.call(nonOwner)).toNumber();

    assert.equal(ticketPurchaserStartingTickets, ticketPurchaserEndingTickets, "Tickets still issued even if reverted!");
  });

  it('minting a ticket outside ticket sale timeslot should revert', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const currentTimestamp = await getCurrentBlockTimestamp();

    const testTicketTimeslot = [10, 100000, currentTimestamp + 15, currentTimestamp + 30, false];
    const ticketMintTx = await eventFactoryInstance.createTicket(eventId, uri, testTicketTimeslot, {from: owner});
    const ticketTimeslotAddress = ticketMintTx.logs[0].args.ticketAddress.valueOf();
    const ticketTSInstance = await Ticket.at(ticketTimeslotAddress);

    const ticketPurchaserStartingTickets = (await ticketTSInstance.balanceOf.call(nonOwner)).toNumber();
    await truffleAssert.reverts(ticketTSInstance.mintTicket(1, {from: nonOwner, value: testTicketTimeslot[1]})); // before ticket sales started

    await timeout(30000);

    await truffleAssert.reverts(ticketTSInstance.mintTicket(1, {from: nonOwner, value: testTicketTimeslot[1]})); // after ticket sales ended
    const ticketPurchaserEndingTickets = (await ticketTSInstance.balanceOf.call(nonOwner)).toNumber();

    assert.equal(ticketPurchaserStartingTickets, ticketPurchaserEndingTickets, "Tickets still issued even if reverted!");
  });

  it('transferring a ticket should transfer ownership to new address', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const ticketGAInstance = await Ticket.at(ticketAddress);

    let nonTicketOwnerStartingTickets = (await ticketGAInstance.balanceOf.call(owner)).toNumber();
    
    const tx = await ticketGAInstance.transferFrom(nonOwner, owner, ticketMintedIdStart, {from: nonOwner});
    console.log("    INFO: Gas used for ticket transfer: " + tx.receipt.gasUsed);

    let nonTicketOwnerEndingTickets = (await ticketGAInstance.balanceOf.call(owner)).toNumber();

    assert.equal(nonTicketOwnerEndingTickets, nonTicketOwnerStartingTickets + 1, 'Wrong number of tickets transfered to non ticket owner!');

    let ownerTotalTickets = await eventFactoryInstance.getTotalTicketsOfSender({from: owner});
    assert.equal(ownerTotalTickets, 1);
  });

  it('transferring a ticket should not be allowed for non owners', async () => {
    const ticketGAInstance = await Ticket.at(ticketAddress);

    let nonTicketOwnerStartingTickets = (await ticketGAInstance.balanceOf.call(owner)).toNumber();
    
    await truffleAssert.reverts(ticketGAInstance.transferFrom(nonOwner, owner, ticketMintedIdStart + 1, {from: owner}));

    let nonTicketOwnerEndingTickets = (await ticketGAInstance.balanceOf.call(owner)).toNumber();

    assert.equal(nonTicketOwnerEndingTickets, nonTicketOwnerStartingTickets, 'Non ticket owner balance is different when it should stay the same!');
  });

  it('validateTicket should return true for ticket holder signature regardless of who sends it', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const latestTimestamp = await getCurrentBlockTimestamp();

    const msg = await eventFactoryInstance.encodeMsg(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp);
    const sig = await getSignature(msg, owner);

    let validated = await eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp, sig.v, sig.r, sig.s, {from: owner});
    assert(validated, 'Ticket should be marked as valid based on signature!');

    let validated2 = await eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp, sig.v, sig.r, sig.s, {from: nonOwner});
    assert(validated2, 'Ticket should be marked as valid based on signature!');
  });

  it('validateTicket should return when not expired, and revert with the same signature after expiry', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const latestTimestamp = await getCurrentBlockTimestamp() - 50;

    const msg = await eventFactoryInstance.encodeMsg(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp);
    const sig = await getSignature(msg, owner);

    let validated = await eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp, sig.v, sig.r, sig.s, {from: owner});
    assert(validated, 'Ticket should be marked as valid based on signature!');

    await timeout(15000);

    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart, latestTimestamp, sig.v, sig.r, sig.s, {from: owner}));
  });

  it('validateTicket should revert on invalid tickets', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const latestTimestamp = await getCurrentBlockTimestamp();
    const msg = await eventFactoryInstance.encodeMsg(eventId, owner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp); // ticketMintedIdStart + 2 is not owned by owner
    const sig = await getSignature(msg, owner);
    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp, sig.v, sig.r, sig.s, {from: owner}));

    const latestTimestamp2 = await getCurrentBlockTimestamp();
    const msg2 = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp2);
    const sig2 = await getSignature(msg2, owner);  // ticketMintedIdStart + 2 is not owned by owner but we sign it with owner here
    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp2, sig2.v, sig2.r, sig2.s, {from: owner}));

    const latestTimestamp3 = await getCurrentBlockTimestamp();
    const msg3 = await eventFactoryInstance.encodeMsg(eventId, owner, ticketAddress, ticketMintedIdStart + 10, latestTimestamp3); // ticketMintedIdStart + 10 is not minted yet
    const sig3 = await getSignature(msg3, owner);
    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, owner, ticketAddress, ticketMintedIdStart + 10, latestTimestamp3, sig3.v, sig3.r, sig3.s, {from: owner}));

    const latestTimestamp4 = await getCurrentBlockTimestamp() - 70; // timestamp is outside range
    const msg4 = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp4);
    const sig4 = await getSignature(msg4, nonOwner);
    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp4, sig4.v, sig4.r, sig4.s, {from: owner}));

    const latestTimestamp5 = await getCurrentBlockTimestamp() + 10; // timestamp is in the future
    const msg5 = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp5);
    const sig5 = await getSignature(msg5, nonOwner);
    await truffleAssert.reverts(eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketMintedIdStart + 2, latestTimestamp5, sig5.v, sig5.r, sig5.s, {from: owner}));
  });

  it('stampTicket should return true only once and false after', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const ticketGAInstance = await Ticket.at(ticketAddress);

    const ticketIdToStamp = parseInt(ticketMintedIdStart) + 1;

    const latestTimestamp = await getCurrentBlockTimestamp();
    const msg = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp);
    const sig = await getSignature(msg, nonOwner);
    let valid = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: owner});
    assert(valid, "Ticket should be marked as not stamped!");

    let txStamped = await ticketGAInstance.stampTicket(ticketIdToStamp, {from: owner});
    console.log("    INFO: Gas used for ticket stamp: " + txStamped.receipt.gasUsed);
    assert.equal(txStamped.logs.length, 1, "No TicketStamped event emitted!");
    assert.equal(txStamped.logs[0].args.ticketId.valueOf().toNumber(), ticketIdToStamp, "Ticket ID should match!");

    let valid2 = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: owner});
    assert(!valid2, "Ticket should be marked as stamped!");
    await truffleAssert.reverts(ticketGAInstance.stampTicket(ticketIdToStamp, {from: owner}));
  });

  it('stampTicket should revert on non stampers', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const ticketGAInstance = await Ticket.at(ticketAddress);

    const ticketIdToStamp = parseInt(ticketMintedIdStart) + 2;

    const latestTimestamp = await getCurrentBlockTimestamp();
    const msg = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp);
    const sig = await getSignature(msg, nonOwner);
    let valid = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: nonOwner});
    assert(valid, "Ticket should be marked as not stamped!");

    await truffleAssert.reverts(ticketGAInstance.stampTicket(ticketIdToStamp, {from: nonOwner}));

    let valid2 = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: nonOwner});
    assert(valid2, "Ticket should be marked as not stamped!");
  });

  it('addresses can be added as stampers to each event and be able to stampTicket successfully', async () => {
    const eventFactoryInstance = await EventFactory.deployed();
    const ticketGAInstance = await Ticket.at(ticketAddress);

    const ticketIdToStamp = parseInt(ticketMintedIdStart) + 2;

    const stamperAddtx = await eventFactoryInstance.addStamperToEvent(nonOwner, eventId, {from: owner});

    assert.equal(stamperAddtx.logs.length, 1, "No StamperAdd event emitted!");
    console.log("    INFO: Gas used for adding ticket stamper: " + stamperAddtx.receipt.gasUsed);

    const latestTimestamp = await getCurrentBlockTimestamp();
    const msg = await eventFactoryInstance.encodeMsg(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp);
    const sig = await getSignature(msg, nonOwner);
    let valid = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: nonOwner});
    assert(valid, "Ticket should be marked as not stamped!");

    let txStamped = await ticketGAInstance.stampTicket(ticketIdToStamp, {from: nonOwner});
    assert.equal(txStamped.logs.length, 1, "No TicketStamped event emitted!");
    assert.equal(txStamped.logs[0].args.ticketId.valueOf().toNumber(), ticketIdToStamp, "Ticket ID should match!");

    let valid2 = await eventFactoryInstance.validateTicket(eventId, nonOwner, ticketAddress, ticketIdToStamp, latestTimestamp, sig.v, sig.r, sig.s, {from: owner});
    assert(!valid2, "Ticket should be marked as stamped!");
  });

  it('non owners should revert when trying to add or remove stampers to event', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    await truffleAssert.reverts(eventFactoryInstance.removeStamperFromEvent(nonOwner, eventId, {from: nonOwner}));
    const stamperRemovetx = await eventFactoryInstance.removeStamperFromEvent(nonOwner, eventId, {from: owner});
    assert.equal(stamperRemovetx.logs.length, 1, "No StamperRemove event emitted!");

    await truffleAssert.reverts(eventFactoryInstance.addStamperToEvent(nonOwner, eventId, {from: nonOwner}));
  });

  it('withdrawing ticket funds from event should send correct balance to owner', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestamp = await getCurrentBlockTimestamp();

    const testEventStruct = [
      currentTimestamp, 
      currentTimestamp + 1];

    const tx = await eventFactoryInstance.createEvent(testEventStruct, {from: owner});
    assert.equal(tx.logs.length, 1, "No EventCreate event emitted!");

    const withdrawEventId = tx.logs[0].args.eventId.valueOf();
    const withdrawTicketStruct = [10, new BN("3000000000000000000"), currentTimestamp, currentTimestamp + 1000000, false];
    const tx2 = await eventFactoryInstance.createTicket(withdrawEventId, uri, withdrawTicketStruct, {from: owner});
    assert.equal(tx2.logs.length, 1, "No TicketCreate event emitted!");

    const withdrawTicketAddress = tx2.logs[0].args.ticketAddress.valueOf();
    const withdrawTicketInstance = await Ticket.at(withdrawTicketAddress);
    const tx3 = await withdrawTicketInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: withdrawTicketStruct[1].muln(numTicketsMinted)});
    assert.equal(tx3.logs.length, numTicketsMinted + 1, "No TicketMint event emitted!");

    let ownerStartingBalance = await web3.eth.getBalance(owner);
    const ownerStartingBalanceeBN = new BN(ownerStartingBalance);

    const tx4 = await withdrawTicketInstance.withdrawBalance({from: owner});
    console.log("    INFO: Gas used for withdraw ticket funds: " + tx4.receipt.gasUsed);
    assert.equal(tx4.logs.length, 1, "No WithdrawBalance event emitted!");

    const gasUsedBN = new BN(tx4.receipt.gasUsed);
    const txRaw = await web3.eth.getTransaction(tx4.tx);
    const gasPriceBN = new BN(txRaw.gasPrice);
    const transactionFee = gasPriceBN.mul(gasUsedBN);
    const ticketRevenue = withdrawTicketStruct[1].muln(numTicketsMinted);
    const diffBalance = ticketRevenue.sub(transactionFee);

    let ownerEndingBalance = await web3.eth.getBalance(owner);
    const ownerEndingBalanceeBN = new BN(ownerEndingBalance);

    diffBalance.should.be.a.bignumber.that.equals(ownerEndingBalanceeBN.sub(ownerStartingBalanceeBN));
  });

  it('withdrawing ticket funds from event should revert before end time or if nonOwner tries to withdraw', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestamp = await getCurrentBlockTimestamp();

    const testEventStruct = [
      currentTimestamp, 
      currentTimestamp + 30];

    const tx = await eventFactoryInstance.createEvent(testEventStruct, {from: owner});
    assert.equal(tx.logs.length, 1, "No EventCreate event emitted!");

    const withdrawEventId = tx.logs[0].args.eventId.valueOf();
    const withdrawTicketStruct = [10, 100000, currentTimestamp, currentTimestamp + 1000000, false];
    const tx2 = await eventFactoryInstance.createTicket(withdrawEventId, uri, withdrawTicketStruct, {from: owner});
    assert.equal(tx2.logs.length, 1, "No TicketCreate event emitted!");

    const withdrawTicketAddress = tx2.logs[0].args.ticketAddress.valueOf();
    const withdrawTicketInstance = await Ticket.at(withdrawTicketAddress);
    const tx3 = await withdrawTicketInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: numTicketsMinted * withdrawTicketStruct[1]});
    assert.equal(tx3.logs.length, numTicketsMinted + 1, "No TicketMint event emitted!");

    await truffleAssert.reverts(withdrawTicketInstance.withdrawBalance({from: owner}));
    await timeout(10000);
    await truffleAssert.reverts(withdrawTicketInstance.withdrawBalance({from: nonOwner})); // nonOwner should not be able to withdraw ticket
  });

  // // ** ticket cancel tests

  it('holders should be able to issue refunds for cancelled events', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestamp = await getCurrentBlockTimestamp();

    const testEventStruct = [
      currentTimestamp, 
      currentTimestamp + 10000];

    const tx = await eventFactoryInstance.createEvent(testEventStruct, {from: owner});
    assert.equal(tx.logs.length, 1, "No EventCreate event emitted!");

    const cancelledEventId = tx.logs[0].args.eventId.valueOf();
    const cancelledTicketStruct = [100, new BN("3000000000000000000"), currentTimestamp, currentTimestamp + 1000000, false];
    const tx2 = await eventFactoryInstance.createTicket(cancelledEventId, uri, cancelledTicketStruct, {from: owner});
    assert.equal(tx2.logs.length, 1, "No TicketCreate event emitted!");

    const cancelledTicketAddress = tx2.logs[0].args.ticketAddress.valueOf();
    const cancelledTicketInstance = await Ticket.at(cancelledTicketAddress);
    const tx3 = await cancelledTicketInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: cancelledTicketStruct[1].muln(numTicketsMinted)});
    assert.equal(tx3.logs.length, numTicketsMinted + 1, "No TicketMint event emitted!");
    const cancelledTicketMintedIdStart = tx3.logs[numTicketsMinted].args.ticketStartId.valueOf();

    let cancelTicketStartingBalance = await web3.eth.getBalance(cancelledTicketAddress);
    const cancelTicketStartingBalanceBN = new BN(cancelTicketStartingBalance);

    const txCancel = await eventFactoryInstance.cancelEvent(cancelledEventId, {from: owner});
    console.log("    INFO: Gas used for cancelling event: " + txCancel.receipt.gasUsed);
    assert.equal(txCancel.logs.length, 1, "No EventCancel event emitted!");

    let nonOwnerStartingBalance = await web3.eth.getBalance(nonOwner);
    const nonOwnerStartingBalanceBN = new BN(nonOwnerStartingBalance);

    const tx4 = await cancelledTicketInstance.refundTicket(cancelledTicketMintedIdStart, {from: nonOwner});
    console.log("    INFO: Gas used for refund one ticket: " + tx4.receipt.gasUsed);
    assert.equal(tx4.logs.length, 2, "No burn Transfer event emitted!");

    const gasUsedBN = new BN(tx4.receipt.gasUsed);
    const txRaw = await web3.eth.getTransaction(tx4.tx);
    const gasPriceBN = new BN(txRaw.gasPrice);
    const transactionFee1 = gasPriceBN.mul(gasUsedBN);

    let checkBalance = await cancelledTicketInstance.balanceOf(nonOwner, {from: nonOwner});
    assert.equal(checkBalance, numTicketsMinted - 1);

    const tx5 = await cancelledTicketInstance.refundAll({from: nonOwner});
    console.log("    INFO: Gas used for refund all tickets: " + tx5.receipt.gasUsed);

    assert.equal(tx5.logs.length, (numTicketsMinted - 1) * 2, "No burn Transfer events emitted!");

    let checkBalance2 = await cancelledTicketInstance.balanceOf(nonOwner, {from: nonOwner});
    assert.equal(checkBalance2, 0);

    const gasUsedBN2 = new BN(tx5.receipt.gasUsed);
    const txRaw2 = await web3.eth.getTransaction(tx5.tx);
    const gasPriceBN2 = new BN(txRaw2.gasPrice);
    const transactionFee2 = gasPriceBN2.mul(gasUsedBN2);
    const diffBalance = (cancelledTicketStruct[1].muln(numTicketsMinted)).sub(transactionFee1.add(transactionFee2));

    let nonOwnerEndingBalance = await web3.eth.getBalance(nonOwner);
    const nonOwnerEndingBalanceeBN = new BN(nonOwnerEndingBalance);

    diffBalance.should.be.a.bignumber.that.equals(nonOwnerEndingBalanceeBN.sub(nonOwnerStartingBalanceBN));

    let cancelTicketEndingBalance = await web3.eth.getBalance(cancelledTicketAddress);
    const cancelTicketEndingBalanceBN = new BN(cancelTicketEndingBalance);

    (cancelledTicketStruct[1].muln(numTicketsMinted)).should.be.a.bignumber.that.equals(cancelTicketStartingBalanceBN.sub(cancelTicketEndingBalanceBN));
  });

  it('holders should not be able to issue refunds for non-cancelled events, and non-owners should not be able to cancel events', async () => {
    const eventFactoryInstance = await EventFactory.deployed();

    const currentTimestamp = await getCurrentBlockTimestamp();

    const testEventStruct = [
      currentTimestamp, 
      currentTimestamp + 10000];

    const tx = await eventFactoryInstance.createEvent(testEventStruct, {from: owner});
    assert.equal(tx.logs.length, 1, "No EventCreate event emitted!");

    const cancelledEventId = tx.logs[0].args.eventId.valueOf();
    const cancelledTicketStruct = [10, new BN("3000000000000000000"), currentTimestamp, currentTimestamp + 1000000, false];

    const tx2 = await eventFactoryInstance.createTicket(cancelledEventId, uri, cancelledTicketStruct, {from: owner});
    assert.equal(tx2.logs.length, 1, "No TicketCreate event emitted!");

    const cancelledTicketAddress = tx2.logs[0].args.ticketAddress.valueOf();
    const cancelledTicketInstance = await Ticket.at(cancelledTicketAddress);

    const tx3 = await cancelledTicketInstance.mintTicket(numTicketsMinted, {from: nonOwner, value: cancelledTicketStruct[1].muln(numTicketsMinted)});
    assert.equal(tx3.logs.length, numTicketsMinted + 1, "No TicketMint event emitted!");
    const cancelledTicketMintedIdStart = tx3.logs[numTicketsMinted].args.ticketStartId.valueOf();

    await truffleAssert.reverts(cancelledTicketInstance.refundTicket(cancelledTicketMintedIdStart, {from: nonOwner}));
    await truffleAssert.reverts(cancelledTicketInstance.refundAll({from: nonOwner}));

    await truffleAssert.reverts(eventFactoryInstance.cancelEvent(cancelledEventId, {from: nonOwner}));
  });
  
});
