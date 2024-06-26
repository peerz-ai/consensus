// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract L2SenderV2 is UUPSUpgradeable {
    function version() external pure returns (uint256) {
        return 2;
    }

    function _authorizeUpgrade(address) internal view override {}
}
