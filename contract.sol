// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MineArt is ERC20, Ownable {
    event NewDrawing(bytes32 hash);

   mapping (uint64 => bool) expiredWithdrawals;

    uint lastDrawingTimestamp;
    uint lastDailyRewardDistribution;
    uint lastSupplyCreatedThroughRewards;

    constructor() ERC20("MineArt", "ART") {
        lastSupplyCreatedThroughRewards = 1000000;
    }

/*
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
*/
    /*
     - override 
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        address sender = _msgSender();

        require(_msgSender() != owner(), "owner is only allowed to transfer funds through withdraw");

        _transfer(sender, to, amount);

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        address spender = _msgSender();

        require(spender != owner(), "owner is not allowed to transfer funds through withdraw");

        _spendAllowance(from, spender, amount);
        
        _transfer(from, to, amount);

        return true;
    }
*/
    /*
    technically owner can still call this and run away, not if owner keeps a transparent blockchain
    we could also include blockheight here

    it is up to the owner to prevent a bank run
    but as owner is not incentivized 


    rationale: 
    if you want to trade you should withdraw yourself (maybe once a week we can sponsor you)
    if you don't care about blockchain at all, you should never have to interact with, directly or indirectly
    you will still be a stakeholder and cone your ART becomes > $100 we can send you an email/notifications that the option
    is available
    */
    function withdraw(uint64 withdrawalId, uint8 _v, uint256 amount, bytes32 _r, bytes32 _s) external {
        // signature must be fresh < 10 minutes
        require(expiredWithdrawals[withdrawalId] == false, "withdrawal expired");

        // check if signature is valid      
        require(owner() == ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n60", msg.sender, withdrawalId, amount)), _v, _r, _s), "signature verification failed");

        expiredWithdrawals[withdrawalId] = true;
        
        // should we somehow put a limit on amount?
        _transfer(owner(), msg.sender, amount);
    }

    /*
        users then are able to access the logs and always verify if a given drawing is legit or not,
        in this case, no master signature is required
        as the hash encompasses all required information (participation, all will be in the file)
    */
    function submitDrawing(bytes32 drawingHash, uint releasedSupply) external onlyOwner {
        // we need scarcity control but maybe something more sophisticated than this, actually, this would put an interesting pressure on users.
        // we can sort paintings by time created and will know exactly when they'll expire then.
        // this also protects against malicious use, owner can't just publish anything under the radar
        require(block.timestamp - lastDrawingTimestamp > 86400, "time constraint exceeded");

        // we need to increase supply here but not necessarily
        // rarity = how much to disperse

        // common = 100
        // uncommon = 1000
        // rare = 5000
        // legendary = 100000

        // we'd basically mint it all to owner / 0 address

        // and then withdraw would take it from this place

        // maybe even store latest hash for when the NFT gets created it can check the last state on chain

        // also max supply can be extended daily by a limited amount
        // that means rewards get less and less the more users there are
        // it means users SHOULD get in early
        // supply can be extended by 
        // A: drawing
        // B: daily cap on activities, let's say we reward the first 1000 logins from different addresses + IP

        

        // in the beginning if there are only a few users they get the big chunk of the rewards, but no special treatment for anyone


        lastDrawingTimestamp = block.timestamp;

        emit NewDrawing(drawingHash);
    }

    function triggerDailyRewards() external {
        require(block.timestamp - lastDailyRewardDistribution > 86400);

        // we should not allow owner to transfer funds 
        // it is minted to owner but users can withdraw using signatures
        // the token has no value outside of the product anyway
        _mint(owner(), lastSupplyCreatedThroughRewards);

        lastSupplyCreatedThroughRewards = (lastSupplyCreatedThroughRewards * 99) / 100;

        lastDailyRewardDistribution = block.timestamp;
    }

    /*
    verification can be done off chain as all drawings will have to have the master signature.
    it wouldn't be too bad to have the data on chain regardless to promote transparency and malicious signatures FROM the owner

    function submitDrawing(bytes32 drawingHash, uint8 accuracy, address[] calldata participants, uint8[] calldata participationRates) external onlyOwner {
        require(participants.length == participationRates.length);

        for (uint i = 0; i < participants.length; ++i) { 
            _mint(participants[i], accuracy * participationRates[i]);
        }

        emit NewDrawing(drawingHash);
    }*/
}

