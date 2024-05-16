# Peerz Consensus

## Introduction

The `Consensus` smart contract is designed to operate within the decentralized deep neural networks, managing and validating state transitions based on the consensus of designated validators.

## Features

- **Validator Management**: Allows dynamic registration and state management of validators to adapt to changes in the network's trust assumptions.
- **Peer and Validator Rewards**: Handles token distributions based on network contributions, calculating rewards based on predefined metrics and distributing them accordingly.
- **Inter-Layer Communication**: Integrates with a Layer 2 sender to manage cross-layer messages and token minting, ensuring fluid operation across blockchain layers.

## Key Functions

### Initialization

- **`Consensus_init`**: Initializes the contract with the address of the L2 sender, the start time for rewards, and the maximum supply of the network token.

### Validator and Peer Management

- **`setValidator`**: Updates the state (active/inactive) of a validator.
- **`registerPeer`**: Registers a new peer with their Ethereum address and peer id.

### State Validation

- **`validateNetworkState`**: Processes network data inputs from peers, validates state transitions based on validator consensus, and updates internal state and token balances accordingly.

### Reward Distribution (POC)

The distribution is subject to a halving mechanism, which reduces the amount of new tokens issued over time. This is similar to mechanisms used by other major cryptocurrencies like Bitcoin, which helps to control inflation and increase scarcity as the network matures.

The initial distribution phase provides a higher rate of tokens to early participants, gradually decreasing over time through predefined halving events.

- **`claim`**: Allows users to claim their accumulated rewards, sending tokens directly to their specified address.
