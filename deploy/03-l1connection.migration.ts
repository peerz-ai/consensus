import { Deployer, Reporter, UserStorage } from '@solarity/hardhat-migrate';
import { ethers } from "hardhat";
import { L2Sender__factory, L1MessageReceiver__factory, PRZ__factory } from '@/generated-types/ethers';
import { IL1MessageReceiver } from '@/generated-types/ethers/contracts/L1MessageReceiver';

const layerZero = '0xae92d5aD7583AD66E49A0c67BAd18F6ba52dDDc1';
const senderChainId = '10217'; // holesky


export = async (deployer: Deployer) => {
  const [owner] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", owner.address);

  const l1MessageReceiver = L1MessageReceiver__factory.connect(
    '0xdbfbf5eC5d0Ab01e74d29a2AC89Ef629792159f7',
    await deployer.getSigner(),
  );

  const l2Sender = L2Sender__factory.connect('0xa822C14B7609766057C01dB5f6C93935BdE37c40', await deployer.getSigner());

  const prz = PRZ__factory.connect('0xcf2F573dA43339784A088BBBBD9c4feE6bf4b362', await deployer.getSigner());

  const l1MessageReceiverConfig: IL1MessageReceiver.ConfigStruct = {
    gateway: layerZero,
    sender: l2Sender,
    senderChainId: senderChainId,
  };

  const tx = await l1MessageReceiver.setParams(prz, l1MessageReceiverConfig);

  await Reporter.reportTransactionByHash(tx.hash);

}
