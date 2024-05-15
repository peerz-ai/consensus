// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IPRZ} from "./interfaces/IPRZ.sol";
import {IL1MessageReceiver} from "./interfaces/IL1MessageReceiver.sol";

contract L1MessageReceiver is IL1MessageReceiver, OwnableUpgradeable, UUPSUpgradeable {
    address public rewardToken;

    Config public config;

    mapping(uint16 => mapping(bytes => mapping(uint64 => bytes32))) public failedMessages;

    constructor() {
        _disableInitializers();
    }

    function L1MessageReceiver__init() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function setParams(address rewardToken_, Config calldata config_) external onlyOwner {
        rewardToken = rewardToken_;
        config = config_;
    }

    function lzReceive(
        uint16 senderChainId_,
        bytes memory senderAndReceiverAddresses_,
        uint64 nonce_,
        bytes memory payload_
    ) external {
        require(_msgSender() == config.gateway, "L1MR: invalid gateway");

        _blockingLzReceive(senderChainId_, senderAndReceiverAddresses_, nonce_, payload_);
    }

    function nonblockingLzReceive(
        uint16 senderChainId_,
        bytes memory senderAndReceiverAddresses_,
        bytes memory payload_
    ) public {
        require(_msgSender() == address(this), "L1MR: invalid caller");

        _nonblockingLzReceive(senderChainId_, senderAndReceiverAddresses_, payload_);
    }

    function retryMessage(
        uint16 senderChainId_,
        bytes memory senderAndReceiverAddresses_,
        uint64 nonce_,
        bytes memory payload_
    ) external {
        bytes32 payloadHash_ = failedMessages[senderChainId_][senderAndReceiverAddresses_][nonce_];
        require(payloadHash_ != bytes32(0), "L1MR: no stored message");
        require(keccak256(payload_) == payloadHash_, "L1MR: invalid payload");

        _nonblockingLzReceive(senderChainId_, senderAndReceiverAddresses_, payload_);

        delete failedMessages[senderChainId_][senderAndReceiverAddresses_][nonce_];

        emit RetryMessageSuccess(senderChainId_, senderAndReceiverAddresses_, nonce_, payload_);
    }

    function _blockingLzReceive(
        uint16 senderChainId_,
        bytes memory senderAndReceiverAddresses_,
        uint64 nonce_,
        bytes memory payload_
    ) private {
        try
            IL1MessageReceiver(address(this)).nonblockingLzReceive(
                senderChainId_,
                senderAndReceiverAddresses_,
                payload_
            )
        {
            emit MessageSuccess(senderChainId_, senderAndReceiverAddresses_, nonce_, payload_);
        } catch (bytes memory reason_) {
            failedMessages[senderChainId_][senderAndReceiverAddresses_][nonce_] = keccak256(payload_);

            emit MessageFailed(senderChainId_, senderAndReceiverAddresses_, nonce_, payload_, reason_);
        }
    }

    function _nonblockingLzReceive(
        uint16 senderChainId_,
        bytes memory senderAndReceiverAddresses_,
        bytes memory payload_
    ) private {
        require(senderChainId_ == config.senderChainId, "L1MR: invalid sender chain ID");

        address sender_;
        assembly {
            sender_ := mload(add(senderAndReceiverAddresses_, 20))
        }
        require(sender_ == config.sender, "L1MR: invalid sender address");

        (address user_, uint256 amount_) = abi.decode(payload_, (address, uint256));

        IPRZ(rewardToken).mint(user_, amount_);
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {}
}
