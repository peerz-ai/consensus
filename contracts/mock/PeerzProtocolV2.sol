// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IPeerzProtocol} from "../PeerzProtocol.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {EndpointV2Mock} from "@layerzerolabs/test-devtools-evm-hardhat/contracts/mocks/EndpointV2Mock.sol";

contract PeerzProtocolV2 is UUPSUpgradeable {
    function version() external pure returns (uint256) {
        return 2;
    }

    function _authorizeUpgrade(address) internal view override {}
}
