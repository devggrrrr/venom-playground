const { TonClient, abiContract, signerKeys, signerNone } = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const { Account } = require("@eversdk/appkit");
const locklift = require("locklift")
const Locklift = new locklift.Locklift()
const Address = Locklift.Address

TonClient.useBinaryLibrary(libNode);

require('dotenv').config()

async function sendVenom() {
    const client = new TonClient({
        network: {
            endpoints: ['gql-testnet.venom.foundation']
        }
    });

    let keys = {
        public: process.env.PUBLIC_KEY, 
        secret: process.env.PRIVATE_KEY
      }// await client.crypto.generate_random_sign_keys();

    const msigTVC =
    readFileSync(path.resolve(__dirname, "./SetcodeMultisig.tvc")).toString("base64")
    const msigABI =
    readFileSync(path.resolve(__dirname, "./SetcodeMultisig.abi.json")).toString("utf8")

    const messageParams = {
        abi: { type: 'Json', value: msigABI },
        deploy_set: { tvc: msigTVC, initial_data: {} },
        signer: { type: 'Keys', keys: keys },
        processing_try_index: 1
    }

    const encoded = await client.abi.encode_message(messageParams)

    const msigAddress = encoded.address

    const everWalletCode =
                readFileSync(path.resolve(__dirname, "./Wallet.code.boc")).toString("base64")
    const everWalletABI =
        readFileSync(path.resolve(__dirname, "./everWallet.abi.json")).toString("utf8")

        const initData = (await client.abi.encode_boc({
            params: [
                { name: "publicKey", type: "uint256" },
                { name: "timestamp", type: "uint64" }
            ],
            data: {
                "publicKey": `0x`+keys.public,
                "timestamp": 0
            }
        })).boc;

        console.log('Init data', initData);
    

    const stateInit = (await client.boc.encode_tvc({
        code:everWalletCode,
        data:initData
    })).tvc;

    const everWalletAddress = `0:`+(await client.boc.get_boc_hash({boc: stateInit})).hash;
    console.log('Address: ', everWalletAddress);

    Locklift.keystore.addKeyPair({publicKey: keys.public, secretKey: keys.secret});
    const LLKeys = Locklift.keystore.getSigner(keys.public);
    const address = new Address(keys.public);

    const contract = await Locklift.factory.getDeployedContract("Sample", new Address(keys.public));
    sample = contract;

    signer = (await Locklift.keystore.getSigner("0"));
    await sample.methods.setStateByOwner({ _state: 10 }).sendExternal({ publicKey: keys.public })

    // Another attempt of sending tokens:
    let body = (await client.abi.encode_message_body({
        address: "0:"+ keys.public,
        abi: { type: 'Json', value: everWalletABI },
        call_set: {      
            function_name: 'sendTransaction',
            input: {
                dest: address,
                value: '1000000000', // amount in nano EVER
                bounce: false,
                flags: 3,
                payload: ''
            }
        },
        is_internal:false,
        signer:{type: 'Keys', keys: keys}
    })).body;

    let deployAndTransferMsg =  await client.boc.encode_external_in_message({
        dst: "0:" + keys.public,
        init: stateInit,
        body: body
    });

    let sendRequestResult = await client.processing.send_message({
        message: deployAndTransferMsg.message,
        send_events: false
    });

    let transaction = (await client.processing.wait_for_transaction({
        abi: { type: 'Json', value: everWalletABI },
        message: deployAndTransferMsg.message,
        shard_block_id: sendRequestResult.shard_block_id,
        send_events: false
    })).transaction;


    console.log('Contract deployed. Transaction hash', transaction.id)
    assert.equal(transaction.status, 3)
    assert.equal(transaction.status_name, "finalized")
}