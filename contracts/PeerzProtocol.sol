// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "hardhat/console.sol";

contract PeerzProtocol is ReentrancyGuard, Pausable {
    mapping(bytes32 => address) public peers;
    mapping(bytes32 => uint) public peerBalances;

    event PeerRegistered(bytes32 indexed peerId, address indexed account);
    event BalancesUpdated(bytes32 peerId, uint balance);

    function registerPeer(bytes32 peerId, address account) public {
        peers[peerId] = account;
        emit PeerRegistered(peerId, account);
    }

    // update balances
    function updateBalances(
        bytes32[] calldata peerIds,
        uint[] calldata throughputs,
        uint[] calldata layers,
        bytes[] calldata signatures,
        address[] calldata addresses
    ) public {
        require(peerIds.length == throughputs.length && throughputs.length == layers.length, "PeerIds, throughputs and layers length mismatch");
        require(signatures.length == addresses.length, "Signatures and addresses length mismatch");

        uint validSignatures = 0;
        bytes32 dataHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(peerIds, throughputs, layers)))
        );

        for (uint i = 0; i < signatures.length; i++) {
            if (ECDSA.recover(dataHash, signatures[i]) == addresses[i]) {
                validSignatures++;
            }
        }

        // Ensure at least 66% consensus
        require(validSignatures * 100 / addresses.length >= 66, "Consensus not reached");

        // If consensus is reached, update balances according to throughputs
        for (uint i = 0; i < peerIds.length; i++) {
            bytes32 peerId = peerIds[i];
            uint balance = peerBalances[peerId];
            peerBalances[peerId] += balance; // Simplified balance update logic
            emit BalancesUpdated(peerId, balance);
        }
    }

  /*   function withdraw(string calldata peerId, uint amount) public nonReentrant {
        require(peerBalances[peerId] >= amount, "Insufficient balance");
        peerBalances[peerId] -= amount;
        payable(peers[peerId]).transfer(amount);
    }
 */
    /* function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function withdrawAll() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function withdrawERC20(address tokenAddress) public onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(owner(), token.balanceOf(address(this)));
    } */

    function testSignature(
        bytes32[] calldata peerIds,
        uint256[] calldata throughputs,
        uint256[] calldata layers,
        bytes calldata signature,
        address account
    ) public pure returns (address) {
        bytes32 dataHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(peerIds, throughputs, layers)))
        );

        console.logBytes32(dataHash);

        
        return ECDSA.recover(dataHash, signature);
    }
}
