import bs58 from 'bs58';
import forge from 'node-forge';

type NetworkState = {
  peerId: string;
  throughput: number;
  layers: number;
};

export const getDefaultNetworkState = async (length: number): Promise<NetworkState[]> => {
  // create 20 peers
  const peers = Array.from({ length }, () => 1);
  // create random throughput and layers
  const throughputs = peers.map((x) => Math.floor(Math.random() * 1000));
  const layers = peers.map((x) => Math.floor(Math.random() * 5 + 1));
  const peerIds = await Promise.all(peers.map(() => generatePeerID()));
  // return the network state
  return peerIds.map((peerId, index) => ({
    peerId: peerId.toString(),
    throughput: throughputs[index],
    layers: layers[index],
  }));
};

export const generatePeerID = () => {
  // Generate an RSA key pair
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const publicKey = forge.pki.publicKeyToPem(keypair.publicKey);

  // Create a SHA-256 hash of the public key
  const md = forge.md.sha256.create();
  md.update(publicKey);
  const digest = md.digest().getBytes();

  // Encode the hash using Base58
  const bytes = Buffer.from(digest, 'binary');
  const base58ID = '12D' + bs58.encode(bytes); // The '12D' prefix is an arbitrary choice for demonstration

  return base58ID;
};
