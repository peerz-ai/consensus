import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  const lock = await ethers.deployContract("PeerzProtocol");
  await lock.waitForDeployment();
  console.log("PeerzProtocol deployed to:", lock.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
