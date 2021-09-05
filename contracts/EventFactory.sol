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
    mapping(address => uint160[]) private ownerToEvent;

    uint256 public currentEventCount;

    event EventCreate(address indexed ownerAddress, uint160 indexed eventId);
    event EventCancel(uint160 indexed eventId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event StamperAdd(uint160 indexed eventId, address indexed stamperAddress);
    event StamperRemove(uint160 indexed eventId, address indexed stamperAddress);
    event TicketCreate(address indexed ownerAddress, uint160 indexed eventId, Ticket indexed ticketAddress);
    
    constructor() {
        currentEventCount = 0;
    }

    /* Event details */

    modifier onlyEventOwner(uint160 eventId) {
        require (msg.sender == eventToOwner[eventId], UNAUTHORIZED);
        _;
    }

    function createEvent(FactoryStructs.EventMetadata calldata _metadata) external returns(uint160 uid) {
        uid = getUniqueId();
        require (eventToOwner[uid] == address(0), INITIALIZATION_ERROR);
        eventToMetadata[uid] = _metadata;
        eventToOwner[uid] = msg.sender;
        ownerToEvent[msg.sender].push(uid);
        emit EventCreate(msg.sender, uid);
        currentEventCount++;
    }

    /**
    * @dev Allows the current owner to transfer control of the event to a newOwner.
    * @param _newOwner The address to transfer ownership to.
    */
    function transferOwnership(uint160 eventId, address _newOwner) external onlyEventOwner(eventId) {
        require(_newOwner != address(0), CANNOT_TRANSFER_TO_ZERO_ADDRESS);
        emit OwnershipTransferred(msg.sender, _newOwner);
        eventToOwner[eventId] = _newOwner;
    }

    function isEventWithdrawable(uint160 eventId) public view returns(bool withdrawable) {
        withdrawable = block.timestamp > eventToMetadata[eventId].timeEnd && !eventToStatus[eventId];
    }

    function cancelEvent(uint160 eventId) external onlyEventOwner(eventId) {
        eventToStatus[eventId] = true;
        emit EventCancel(eventId);
    }

    /* Ticket minting and transfer */

    function createTicket(uint160 eventId, FactoryStructs.TicketMetadata calldata _ticketMetadata) external onlyEventOwner(eventId)  {
        Ticket t = new Ticket(this, eventId, _ticketMetadata);
        _eventToTicket[eventId].add(address(t));
        emit TicketCreate(msg.sender, eventId, t);
    }

    function addTicketToOwner(address owner, uint160 eventId) external {
        require(_eventToTicket[eventId].contains(msg.sender), UNAUTHORIZED);
        _holderToTicket[owner].add(msg.sender);
    }

    function removeTicketFromOwner(address owner, uint160 eventId) external {
        require(_eventToTicket[eventId].contains(msg.sender), UNAUTHORIZED);
        _holderToTicket[owner].remove(msg.sender);
    }

    function getTicketsOfSenderByIndex(uint256 index) external view returns(address) {
        return _holderToTicket[msg.sender].at(index);
    }

    function getTotalTicketsOfSender() external view returns(uint256) {
        return _holderToTicket[msg.sender].length();
    }

    // use blocktime and read signed message to see if it is correct
    // reverts if ticket is invalid
    // returns true if ticket is not stamped, and false if ticket is stamped
    function validateTicket(uint160 eventId, address holder, Ticket ticket, uint256 ticketId, uint256 timestamp, uint8 v, bytes32 r, bytes32 s) public view returns(bool) {
        require(eventToOwner[eventId] != address(0), NOT_EXISTS);
        require(_eventToTicket[eventId].contains(address(ticket)), NOT_EXISTS);
        require(block.timestamp < SafeMath.add(timestamp, VALIDATION_TIMEOUT) && block.timestamp >= timestamp);
        require (ticket.ownerOf(ticketId) == holder);

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
}

contract Ticket is TNT721 {
    string public constant UNAUTHORIZED = "019001";
    string public constant CANNOT_TRANSFER_TO_ZERO_ADDRESS = "019004";
    string public constant TICKET_SALE_ERROR = "019006";
    string public constant INVALID_ACTION = "019007";

    EventFactory private factory;

    FactoryStructs.TicketMetadata public metadata;

    uint160 private eventId;

    mapping(uint256 => bool) public tokenToStamped;

    event TicketMint(address indexed mintedAddress, uint256 indexed ticketStartId, uint256 indexed ticketEndId);
    event TicketStamped(uint256 indexed ticketId);
    event WithdrawBalance();

    constructor(EventFactory _factory, uint160 _eventId, FactoryStructs.TicketMetadata memory _ticketMetadata) TNT721("TKETS NFT", "TKET") {
        metadata = _ticketMetadata;
        eventId = _eventId;
        factory = _factory;
    }
    
    function mintTicket(uint256 numberOfTickets) external payable {
        require(numberOfTickets != 0, TICKET_SALE_ERROR);
        uint256 ticketSaleValue = SafeMath.mul(metadata.ticketPrice, numberOfTickets);
        require(msg.value == ticketSaleValue || (metadata.acceptDonations && msg.value > ticketSaleValue), TICKET_SALE_ERROR);
        require(!factory.eventToStatus(eventId), TICKET_SALE_ERROR);
        require(block.timestamp > metadata.ticketStartTime && block.timestamp < metadata.ticketEndTime, TICKET_SALE_ERROR);
        uint256 currentTicketCount = totalSupply();
        uint256 endTicketCount = SafeMath.add(currentTicketCount, numberOfTickets);
        require(endTicketCount <= metadata.maxTickets, TICKET_SALE_ERROR);

        bool newHolder = balanceOf(msg.sender) == 0;
        for (uint256 i = 0; i < numberOfTickets; i++) {
            super._mint(msg.sender, currentTicketCount + i);
        }
        if (newHolder) {
            factory.addTicketToOwner(msg.sender, eventId);
        }
        emit TicketMint(msg.sender, currentTicketCount, endTicketCount - 1);
    }

    function stampTicket(uint256 ticketId) external {
        require(msg.sender == factory.eventToOwner(eventId) || factory.isStamperAuthorized(msg.sender, eventId), UNAUTHORIZED);
        require(!tokenToStamped[ticketId]);
        tokenToStamped[ticketId] = true;
        emit TicketStamped(ticketId);
    }

    function transferFrom(address _from, address _to, uint256 tokenId) public override {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "TNT721: transfer caller is not owner nor approved");

        bool prevOwnerHasZeroBalance = balanceOf(_from) == 1;
        bool newOwnerHasZeroBalance = balanceOf(_to) == 0;

        _transfer(_from, _to, tokenId);

        if (prevOwnerHasZeroBalance) {
            factory.removeTicketFromOwner(_from, eventId);
        }

        if (newOwnerHasZeroBalance) {
            factory.addTicketToOwner(_to, eventId);
        }
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
        bool prevOwnerHasZeroBalance = balanceOf(msg.sender) == 1;
        _burn(tokenId);
        if (prevOwnerHasZeroBalance) {
            factory.removeTicketFromOwner(msg.sender, eventId);
        }
        payable(msg.sender).transfer(metadata.ticketPrice);
    }

    function refundAll() external {
        require(factory.eventToStatus(eventId), INVALID_ACTION);
        uint256 balanceTickets = balanceOf(msg.sender);
        require(balanceTickets > 0, INVALID_ACTION);
        for (uint256 i = 0; i < balanceTickets; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(msg.sender, 0);
            _burn(tokenId);
        }
        factory.removeTicketFromOwner(msg.sender, eventId);
        payable(msg.sender).transfer(SafeMath.mul(metadata.ticketPrice, balanceTickets));
    }
}
