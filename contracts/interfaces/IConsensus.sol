// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IConsensus {
    /**
     * The event that is emitted when the peer is registered.
     * @param peerId The peer's id.
     * @param account The peer's address.
     */
    event PeerRegistered(bytes32 indexed peerId, address indexed account);

    /**
     * The event that is emitted when the peer's balance is updated.
     * @param account The peer's address.
     * @param amount The peer's amount.
     */
    event BalancesUpdated(address account, uint256 amount);

    /**
     * The event that is emitted when the user claims rewards from the pool.
     * @param user The user's address.
     * @param receiver The receiver's address.
     * @param amount The amount of tokens.
     */
    event UserClaimed(address indexed user, address receiver, uint256 amount);

    /**
     * The function to get the peer's address by id.
     * @param peerId The peer's id.
     * @return peerAddress peer's address.
     */
    // function peers(bytes32 peerId) external view returns (address peerAddress);

    /**
     * The function to get the peer's balance by address.
     * @param peerAddress The peer's address.
     * @return peerBalance peer's balance.
     */
    // function peerBalances(address peerAddress) external view returns (uint256 peerBalance);

    /**
     * The function to get the validator existance.
     * @param account The validator address.
     * @return exists The validator existance.
     */
    // function validators(address account) external view returns (bool exists);

    /**
     * The function to get the validator's balance.
     * @param account The validator address.
     * @return amount The validator's balance.
     */
    // function validatorBalances(address account) external view returns (uint256 amount);

    /**
     * The function to register the peer.
     * @param peerId The peer's id.
     * @param account The peer's address.
     */
    // function registerPeer(bytes32 peerId, address account) external;

    /**
     * The function to update the peer's balance.
     * @param peerIds The peers ids.
     * @param contributions The peers contributions.
     * @param total The total throughput mul layers.
     * @param signatures The validators signatures.
     * @param validators The validators addresses.
     */
    /* function validateNetworkState(
        bytes32[] calldata peerIds,
        uint256[] calldata contributions,
        uint256 total,
        bytes[] calldata signatures,
        address[] calldata validators
    ) external; */

    /**
     * The function to claim the rewards.
     * @param receiver The receiver's address.
     */
    // function claim(address receiver) external payable;
}
