// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import "./TNT721.sol";

library FactoryStructs {
    struct EventMetadata {
        uint256 timeStart;
        uint256 timeEnd;
    }
    
    struct TicketMetadata {
        uint256 maxTickets;
        uint256 ticketPrice;
        uint256 ticketStartTime;
        uint256 ticketEndTime;
        bool acceptDonations;
    }
}

contract EventFactory {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    uint256 public constant VALIDATION_TIMEOUT = 60;
    string public constant UNAUTHORIZED = "019001";
    string public constant INVALID_INPUT = "019002";
    string public constant INITIALIZATION_ERROR = "019003";
    string public constant CANNOT_TRANSFER_TO_ZERO_ADDRESS = "019004";
    string public constant NOT_EXISTS = "019005";

    // keeps track of which tickets each holder has
    mapping(address => EnumerableSet.AddressSet) private _holderToTicket;

    mapping(uint160 => EnumerableSet.AddressSet) private _eventToTicket;
    mapping(uint160 => FactoryStructs.EventMetadata) public eventToMetadata;
    mapping(uint160 => address) public eventToOwner;
    mapping(uint160 => bool) public eventToStatus;
    mapping(uint160 => EnumerableSet.AddressSet) private _eventToStampers;

    uint256 public currentEventCount;
    address public TKETSOwner;
    uint256 public commissionRate; // commission = commissionRate / 10000 * ticket Price

    event CommissionRateChange(uint256 indexed newCommissionRate);
    event EventCreate(address indexed ownerAddress, uint160 indexed eventId, uint256 timeStart, uint256 timeEnd);
    event EventCancel(uint160 indexed eventId);
    event OwnershipTransferred(uint160 indexed eventId, address indexed previousOwner, address indexed newOwner);
    event StamperAdd(uint160 indexed eventId, address indexed stamperAddress);
    event StamperRemove(uint160 indexed eventId, address indexed stamperAddress);
    event TicketCreate(address indexed ownerAddress, uint160 indexed eventId, Ticket indexed ticketAddress, string uri, bytes32 uriHash, bool useTokenIDInURI, uint256 maxTickets, uint256 ticketPrice, uint256 ticketStartTime, uint256 ticketEndTime, bool acceptDonations);
    
    constructor() {
        currentEventCount = 0;
        commissionRate = 0;
        TKETSOwner = msg.sender;
    }

    modifier onlyTKETSOwner() {
        require (msg.sender == TKETSOwner, UNAUTHORIZED);
        _;
    }

    /* META */

    function setCommissionRate(uint256 _rate) external onlyTKETSOwner {
        commissionRate = _rate;
        emit CommissionRateChange(_rate);
    }

    function withdrawCommissions() external onlyTKETSOwner{
        payable(TKETSOwner).transfer(address(this).balance);
    }

    function transferTKETSOwnership(address newOwner) external onlyTKETSOwner{
        TKETSOwner = newOwner;
    }

    /* Event details */

    modifier onlyEventOwner(uint160 eventId) {
        require (msg.sender == eventToOwner[eventId], UNAUTHORIZED);
        _;
    }

    function forceCreateEvent(uint160 eventId, address eventOwner, FactoryStructs.EventMetadata calldata _metadata) external onlyTKETSOwner returns(uint160 uid) {
        uid = eventId;
        require (eventToOwner[uid] == address(0), INITIALIZATION_ERROR);
        eventToMetadata[uid] = _metadata;
        eventToOwner[uid] = eventOwner;
        // emit EventCreate(eventOwner, uid, _metadata.timeStart, _metadata.timeEnd);
        currentEventCount++;
    }

    function createEvent(FactoryStructs.EventMetadata calldata _metadata) external returns(uint160 uid) {
        uid = getUniqueId();
        require (eventToOwner[uid] == address(0), INITIALIZATION_ERROR);
        eventToMetadata[uid] = _metadata;
        eventToOwner[uid] = msg.sender;
        emit EventCreate(msg.sender, uid, _metadata.timeStart, _metadata.timeEnd);
        currentEventCount++;
    }

    /**
    * @dev Allows the current owner to transfer control of the event to a newOwner.
    * @param _newOwner The address to transfer ownership to.
    */
    function transferOwnership(uint160 eventId, address _newOwner) external onlyEventOwner(eventId) {
        require(_newOwner != address(0), CANNOT_TRANSFER_TO_ZERO_ADDRESS);
        eventToOwner[eventId] = _newOwner;
        emit OwnershipTransferred(eventId, msg.sender, _newOwner);
    }

    function isEventWithdrawable(uint160 eventId) public view returns(bool withdrawable) {
        withdrawable = block.timestamp > eventToMetadata[eventId].timeEnd && !eventToStatus[eventId];
    }

    function cancelEvent(uint160 eventId) external onlyEventOwner(eventId) {
        eventToStatus[eventId] = true;
        emit EventCancel(eventId);
    }

    /* Ticket minting and transfer */

    function createTicket(uint160 eventId, string calldata uri, bytes32 uriHash, bool useTokenIDInURI, FactoryStructs.TicketMetadata calldata _ticketMetadata) external onlyEventOwner(eventId)  {
        Ticket t = new Ticket(this, eventId, uri, uriHash, useTokenIDInURI, _ticketMetadata);
        _eventToTicket[eventId].add(address(t));
        emit TicketCreate(msg.sender, eventId, t, uri, uriHash, useTokenIDInURI, _ticketMetadata.maxTickets, _ticketMetadata.ticketPrice, _ticketMetadata.ticketStartTime, _ticketMetadata.ticketEndTime, _ticketMetadata.acceptDonations);
    }

    function forceCreateTicketFromAddress(uint160 eventId, Ticket ticket) external onlyTKETSOwner  {
        _eventToTicket[eventId].add(address(ticket));
        // emit TicketCreate(msg.sender, eventId, ticket, uri, uriHash, useTokenIDInURI, _ticketMetadata.maxTickets, _ticketMetadata.ticketPrice, _ticketMetadata.ticketStartTime, _ticketMetadata.ticketEndTime, _ticketMetadata.acceptDonations);
    }

    // use blocktime and read signed message to see if it is correct
    // reverts if ticket is invalid
    // returns true if ticket is not stamped, and false if ticket is stamped
    function validateTicket(uint160 eventId, address holder, Ticket ticket, uint256 ticketId, uint256 timestamp, uint8 v, bytes32 r, bytes32 s) public view returns(bool) {
        require(eventToOwner[eventId] != address(0), NOT_EXISTS);
        require(_eventToTicket[eventId].contains(address(ticket)), NOT_EXISTS);
        require(block.timestamp < SafeMath.add(timestamp, VALIDATION_TIMEOUT) && block.timestamp >= SafeMath.sub(timestamp, 10)); // have some leeway for starting time
        require(ticket.ownerOf(ticketId) == holder);

        bytes32 message = encodeMsg(eventId, holder, ticket, ticketId, timestamp);    
        bytes32 prefixedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        require(ecrecover(prefixedHash, v, r, s) == holder);

        return !ticket.tokenToStamped(ticketId);
    }

    /* Stampers */

    function isStamperAuthorized(address stamper, uint160 eventId) public view returns(bool authorized) {
        authorized = _eventToStampers[eventId].contains(stamper);
    }

    function addStamperToEvent(address stamper, uint160 eventId) external onlyEventOwner(eventId) {
        _eventToStampers[eventId].add(stamper);
        emit StamperAdd(eventId, stamper);
    }

    function removeStamperFromEvent(address stamper, uint160 eventId) external onlyEventOwner(eventId) {
        _eventToStampers[eventId].remove(stamper);
        emit StamperRemove(eventId, stamper);
    }

    /* Utils */

    /**
    * @dev Generate a unique ID
    */  
    function getUniqueId() internal view returns (uint160 uid) {
        uid = uint160(uint256(keccak256(abi.encodePacked(msg.sender, currentEventCount, block.timestamp))));
    }

    function encodeMsg(uint160 eventId, address holder, Ticket ticket, uint256 ticketId, uint256 timestamp) public pure returns (bytes32 message) {
        message = keccak256(abi.encodePacked(eventId, holder, ticket, ticketId, timestamp));    
    }

    receive() external payable { }
 
}

contract Ticket is TNT721 {
    string public constant UNAUTHORIZED = "019001";
    string public constant CANNOT_TRANSFER_TO_ZERO_ADDRESS = "019004";
    string public constant TICKET_SALE_ERROR = "019006";
    string public constant INVALID_ACTION = "019007";

    EventFactory private factory;

    FactoryStructs.TicketMetadata public metadata;

    uint160 public eventId;
    bytes32 uriHash;
    bool public useTokenIDInURI;

    mapping(uint256 => bool) public tokenToStamped;

    event TicketMint(address indexed mintedAddress, uint256 indexed ticketId);
    event TicketStamped(uint256 indexed ticketId);
    event TicketRefund(address refundedAddress);
    event WithdrawBalance(); 

    using Strings for uint256;

    constructor(EventFactory _factory, uint160 _eventId, string memory uri, bytes32 _uriHash, bool _useTokenIDInURI, FactoryStructs.TicketMetadata memory _ticketMetadata) TNT721("TKETS NFT", "TKET") {
        metadata = _ticketMetadata;
        eventId = _eventId;
        uriHash = _uriHash;
        useTokenIDInURI = _useTokenIDInURI;
        factory = _factory;
        _setBaseURI(uri);
    }
    
    function mintTicket(uint256 numberOfTickets) external payable {
        require(numberOfTickets != 0, TICKET_SALE_ERROR);
        uint256 ticketCommission = SafeMath.div(SafeMath.mul(metadata.ticketPrice, factory.commissionRate()), 10000);
        uint256 ticketSalePrice = SafeMath.add(metadata.ticketPrice, ticketCommission);
        uint256 ticketSaleValue = SafeMath.mul(ticketSalePrice, numberOfTickets);
        require(msg.value == ticketSaleValue || (metadata.acceptDonations && msg.value > ticketSaleValue), TICKET_SALE_ERROR);
        require(!factory.eventToStatus(eventId), TICKET_SALE_ERROR);
        require(block.timestamp > SafeMath.sub(metadata.ticketStartTime, 10) && block.timestamp < metadata.ticketEndTime, TICKET_SALE_ERROR); // have some leeway for starting time
        uint256 currentTicketCount = totalSupply();
        uint256 endTicketCount = SafeMath.add(currentTicketCount, numberOfTickets);
        require(metadata.maxTickets == 0 || endTicketCount <= metadata.maxTickets, TICKET_SALE_ERROR);

        for (uint256 i = 1; i <= numberOfTickets; i++) {
            uint256 nextTokenId = currentTicketCount + i;
            super._mint(msg.sender, nextTokenId);
            emit TicketMint(msg.sender, nextTokenId);
        }

        if (ticketCommission > 0) {
            payable(factory).transfer(SafeMath.mul(ticketCommission, numberOfTickets));
        }
    }

    function stampTicket(uint256 ticketId) external {
        require(msg.sender == factory.eventToOwner(eventId) || factory.isStamperAuthorized(msg.sender, eventId), UNAUTHORIZED);
        require(!tokenToStamped[ticketId]);
        tokenToStamped[ticketId] = true;
        emit TicketStamped(ticketId);
    }

    function transferFrom(address _from, address _to, uint256 tokenId) public override {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "TNT721: transfer caller is not owner nor approved");

        _transfer(_from, _to, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "TNT721Metadata: URI query for nonexistent token");

        if (useTokenIDInURI) {
            return string(abi.encodePacked(super.baseURI(), "/", tokenId.toString()));
        }

        return super.baseURI();
    }

    function withdrawBalance() external {
        require(factory.isEventWithdrawable(eventId), INVALID_ACTION);
        require(msg.sender == factory.eventToOwner(eventId), UNAUTHORIZED);
        payable(msg.sender).transfer(address(this).balance);
        emit WithdrawBalance();
    }

    function refundTicket(uint256 tokenId) external {
        require(factory.eventToStatus(eventId), INVALID_ACTION);
        require(_isApprovedOrOwner(_msgSender(), tokenId), "TNT721: transfer caller is not owner nor approved");
        _burn(tokenId);
        emit TicketRefund(msg.sender);
        payable(msg.sender).transfer(metadata.ticketPrice);
    }

    function refundAll() external {
        require(factory.eventToStatus(eventId), INVALID_ACTION);
        uint256 balanceTickets = balanceOf(msg.sender);
        require(balanceTickets > 0, INVALID_ACTION);
        for (uint256 i = 0; i < balanceTickets; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(msg.sender, 0);
            _burn(tokenId);
            emit TicketRefund(msg.sender);
        }

        payable(msg.sender).transfer(SafeMath.mul(metadata.ticketPrice, balanceTickets));
    }
}
