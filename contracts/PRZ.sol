// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20, ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

import {IPRZ, IERC20, IERC165} from "./interfaces/IPRZ.sol";

/**
 * @title PRZ
 * @dev PRZ token contract
 */
contract PRZ is IPRZ, ERC20Capped, ERC20Burnable, Ownable {

    // State variable to control whether tokens can be sent to contracts
    bool public onlyEOA = true;

    constructor(uint256 cap_) ERC20("PRZ", "PRZ") ERC20Capped(cap_) Ownable(msg.sender) {
        
    }

    modifier onlyEOAAllowed(address to) {
        require(!onlyEOA || to.code.length == 0, "PRZ: only EOA allowed");
        _;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId_) public pure returns (bool) {
        return
            interfaceId_ == type(IPRZ).interfaceId ||
            interfaceId_ == type(IERC20).interfaceId ||
            interfaceId_ == type(IERC165).interfaceId;
    }

    /**
     * @dev See {ERC20-transfer}.
     */
    function transfer(address to, uint256 amount) public override(IERC20, ERC20) onlyEOAAllowed(to) returns (bool) {
        return ERC20.transfer(to, amount);
    }

    /**
     * @dev See {ERC20-transferFrom}.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override(IERC20, ERC20) onlyEOAAllowed(to) returns (bool) {
        return ERC20.transferFrom(from, to, amount);
    }

    /**
     * @dev returns the cap of the token
     * @return cap of the token
     */
    function cap() public view override(IPRZ, ERC20Capped) returns (uint256) {
        return ERC20Capped.cap();
    }

    /**
     * @dev See {ERC20-_mint}.
     */
    function mint(address account_, uint256 amount_) external onlyEOAAllowed(account_) onlyOwner {
        _mint(account_, amount_);
    }

    /**
     * @dev See {ERC20Burnable-burn}.
     */
    function burn(uint256 amount_) public override {
        ERC20Burnable.burn(amount_);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }

    /**
     * @dev Toggles the onlyEOA state variable
     */
    function disableOnlyEOA(bytes[] calldata signatures) external onlyOwner {
        require(onlyEOA, "PRZ: EOA restriction has already been toggled off");
        uint256 requiredVotes = (totalSupply() * 66) / 100;
        uint256 accumulatedVotes = 0;
        bool _onlyEOA = false;

        for (uint i = 0; i < signatures.length; i++) {
            // Recover signer from signature
            address signer = ECDSA.recover(keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    keccak256(abi.encodePacked(address(this), _onlyEOA))
                )
            ), signatures[i]);

            if (balanceOf(signer) == 0 || signer == address(0)) {
                continue;
            }

            accumulatedVotes += balanceOf(signer);
            if (accumulatedVotes >= requiredVotes) {
                onlyEOA = _onlyEOA;
                return;
            }
        }

        revert("PRZ: voting threshold not met");
    }
}
