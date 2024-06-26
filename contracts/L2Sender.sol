// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ILayerZeroEndpoint} from "@layerzerolabs/lz-evm-sdk-v1-0.7/contracts/interfaces/ILayerZeroEndpoint.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IL2Sender, IERC165} from "./interfaces/IL2Sender.sol";

contract L2Sender is IL2Sender, OwnableUpgradeable, UUPSUpgradeable {
    address public consensus;

    RewardTokenConfig public rewardTokenConfig;

    modifier onlyConsensus() {
        require(_msgSender() == consensus, "L2S: invalid sender");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function L2Sender__init(address consensus_, RewardTokenConfig calldata rewardTokenConfig_) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        setConsensus(consensus_);
        setRewardTokenConfig(rewardTokenConfig_);
    }

    function setRewardTokenConfig(RewardTokenConfig calldata newConfig_) public onlyOwner {
        rewardTokenConfig = newConfig_;
    }

    function supportsInterface(bytes4 interfaceId_) external pure returns (bool) {
        return interfaceId_ == type(IL2Sender).interfaceId || interfaceId_ == type(IERC165).interfaceId;
    }

    function setConsensus(address consensus_) public onlyOwner {
        consensus = consensus_;
    }

    function sendMintMessage(address user_, uint256 amount_, address refundTo_) external payable onlyConsensus {
        RewardTokenConfig storage config = rewardTokenConfig;

        bytes memory receiverAndSenderAddresses_ = abi.encodePacked(config.receiver, address(this));
        bytes memory payload_ = abi.encode(user_, amount_);

        ILayerZeroEndpoint(config.gateway).send{value: msg.value}(
            config.receiverChainId, // communicator LayerZero chainId
            receiverAndSenderAddresses_, // send to this address to the communicator
            payload_, // bytes payload
            payable(refundTo_), // refund address
            config.zroPaymentAddress, // future parameter
            config.adapterParams // adapterParams (see "Advanced Features")
        );
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {}
}
