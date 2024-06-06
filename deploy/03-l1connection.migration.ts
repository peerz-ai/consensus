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
    UserStorage.get('L1MessageReceiver Proxy'),
    await deployer.getSigner(),
  );

  const l2Sender = L2Sender__factory.connect(UserStorage.get('L2Sender Proxy'), await deployer.getSigner());

  const prz = PRZ__factory.connect(UserStorage.get('PRZ'), await deployer.getSigner());

  const l1MessageReceiverConfig: IL1MessageReceiver.ConfigStruct = {
    gateway: layerZero,
    sender: l2Sender,
    senderChainId: senderChainId,
  };

  const tx = await l1MessageReceiver.setParams(prz, l1MessageReceiverConfig);

  await Reporter.reportTransactionByHash(tx.hash);

  console.log(UserStorage.getAll())

}
