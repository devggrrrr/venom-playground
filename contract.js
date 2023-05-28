const { TonClient, abiContract, signerKeys, signerNone } = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const { Account } = require("@eversdk/appkit");
const locklift = require("locklift")
const Locklift = new locklift.Locklift()
const Address = Locklift.Address
const { readFileSync } = require("fs")
const path = require("path")


function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

MINIMAL_BALANCE = .01

TonClient.useBinaryLibrary(libNode);

async function main(client) {
    // 
    // 1. ------------------ Deploy multisig wallet --------------------------------
    // 
    // Generate a key pair for the wallet to be deployed
    const keypair = {
        "public": "",
        "secret": ""
    }

    // TODO: Save generated keypair!
    console.log('Generated wallet keys:', JSON.stringify(keypair))
    console.log('Do not forget to save the keys!')

    // To deploy a wallet we need its TVC and ABI files
    const msigTVC =
        readFileSync(path.resolve(__dirname, "./HelloWallet.tvc")).toString("base64")
    const msigABI =
        readFileSync(path.resolve(__dirname, "./HelloWallet.abi.json")).toString("utf8")

    // We need to know the future address of the wallet account,
    // because its balance must be positive for the contract to be deployed
    // Future address can be calculated by encoding the deploy message.
    // https://docs.everos.dev/ever-sdk/reference/types-and-methods/mod_abi#encode_message

    const messageParams = {
        abi: { type: 'Json', value: msigABI },
        deploy_set: { tvc: msigTVC, initial_data: {} },
        signer: { type: 'Keys', keys: keypair },
        processing_try_index: 1
    }

    const encoded = await client.abi.encode_message(messageParams)

    const msigAddress = await calcWalletAddress(client, keypair)

    console.log(`Please send >= ${MINIMAL_BALANCE} tokens to ${msigAddress}`)
    console.log(`awaiting...`)

    // Blocking here, waiting for account balance changes.
    // It is assumed that at this time you replenish this account.
    let balance
    for (; ;) {
        // The idiomatic way to send a request is to specify 
        // query and variables as separate properties.
        const getBalanceQuery = `
                query getBalance($address: String!) {
                    blockchain {
                    account(address: $address) {
                            info {
                            balance
                        }
                    }
                }
            }
            `
        const resultOfQuery = await client.net.query({
            query: getBalanceQuery,
            variables: { address: msigAddress }
        })

        const nanotokens = parseInt(resultOfQuery.result.data.blockchain.account.info?.balance, 16)
        console.log(nanotokens)
        console.log(MINIMAL_BALANCE * 1e9)
        if (nanotokens > MINIMAL_BALANCE * 1e9) {
            balance = nanotokens / 1e9
            break
        }
        // TODO: rate limiting
        await sleep(1000)
    }
    console.log(`Account balance is: ${balance.toString(10)} tokens`)

    console.log(`Deploying wallet contract to address: ${msigAddress} and waiting for transaction...`)

    // This function returns type `ResultOfProcessMessage`, see: 
    // https://docs.everos.dev/ever-sdk/reference/types-and-methods/mod_processing#process_message

    try {
        let result = await client.processing.process_message({
            message_encode_params: {
                ...messageParams,  // use the same params as for `encode_message`,
                call_set: {        // plus add `call_set`
                    function_name: 'constructor',
                    input: {
                        owners: [`0x${keypair.public}`],
                        reqConfirms: 1,
                        lifetime: 3600
                    }
                },
            },
            send_events: false,
        })
        console.log('Contract deployed. Transaction hash', result.transaction?.id)
        assert.equal(result.transaction?.status, 3)
        assert.equal(result.transaction?.status_name, "finalized")
    } catch (e) {
        console.log(e)
    }
}

async function walletGen(client) {
    const keypair = await client.crypto.generate_random_sign_keys();

    // TODO: Save generated keypair!
    console.log('Generated wallet keys:', JSON.stringify(keypair))
    console.log('Do not forget to save the keys!')

    // To deploy a wallet we need its code and ABI files
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
                "publicKey": `0x`+keypair.public,
                "timestamp": 0
            }
        })).boc;

        console.log('Init data', initData);
    

    const stateInit = (await client.boc.encode_state_init({
        code:everWalletCode,
        data:initData
    })).state_init;

    const everWalletAddress = `0:`+(await client.boc.get_boc_hash({boc: stateInit})).hash;
    console.log('Address: ', everWalletAddress);
}

async function calcWalletAddress(client, keys) {
    // Get future `Hello`Wallet contract address from `encode_message` result
    const { address } = await client.abi.encode_message(buildDeployOptions(keys));
    console.log(`Future address of Hello wallet contract is: ${address}`);
    return address;
}

function buildDeployOptions(keys) {
    // Prepare parameters for deploy message encoding
    // See more info about `encode_message` method parameters here:
    // https://github.com/tonlabs/ever-sdk/blob/master/docs/reference/types-and-methods/mod_abi.md#encode_message
    const deployOptions = {
        abi: {
            type: 'Contract',
            value: HelloWallet.HelloWallet.abi,
        },
        deploy_set: {
            tvc: HelloWallet.HelloWallet.tvc,
            initial_data: {},
        },
        call_set: {
            function_name: 'constructor',
            input: {},
        },
        signer: {
            type: 'Keys',
            keys,
        },
    };
    return deployOptions;
}

async function sendTXN(client, keys="") {
    keys = {
        "public": "",
        "secret": ""
    }

    const everWalletCode =
                readFileSync(path.resolve(__dirname, "./Wallet.code.boc")).toString("base64")
    const everWalletABI =
        readFileSync(path.resolve(__dirname, "./everWallet.abi.json")).toString("utf8")

    // const stateInit = (await client.boc.encode_tvc({
    //     code:everWalletCode,
    //     data:initData
    // })).tvc;

    // const everWalletAddress = `0:`+(await client.boc.get_boc_hash({boc: stateInit})).hash;
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

    let result = await client.processing.process_message({
        message_encode_params: {
            address: "0:0a9f2f53ea912f6612e240ab5cba3ec83f878859aeb8fde62cbf5ac968899a99",
            ...messageParams, // use the same params as for `encode_message`,
            call_set: {       // plus add `call_set`
                function_name: 'sendTransaction',
                input: {
                    dest: "0:172af1d268b7a2e169b216fd397c410dfb9bd13908cf293b0069932b91b87ee1",
                    value: 1e9,
                    bounce: false,
                    flags: 64,
                    payload: ''
                }
            },
        },
        send_events: false, // do not send intermidate events
    })
    console.log('Transfer completed. Transaction hash', result.transaction?.id)

//     let deployAndTransferMsg =  await client.boc.encode_external_in_message({
//         dst: "0:172af1d268b7a2e169b216fd397c410dfb9bd13908cf293b0069932b91b87ee1",
//         init: stateInit,
//         body: body
//     });

//     let sendRequestResult = await client.processing.send_message({
//         message: deployAndTransferMsg,
//         send_events: false
//     });

//     let transaction = (await client.processing.wait_for_transaction({
//         abi: { type: 'Json', value: everWalletABI },
//         message: deployAndTransferMsg.message,
//         shard_block_id: sendRequestResult.shard_block_id,
//         send_events: false
//     })).transaction;
// }
}


const client = new TonClient({
    network: {
        endpoints: ['gql-testnet.venom.foundation']
    }
});

async function run() {
    await walletGen(client)
}

const HelloWallet = {
    HelloWallet: {
        abi: {
            "ABI version": 2,
            "header": ["time", "expire"],
            "functions": [
                {
                    "name": "constructor",
                    "inputs": [
                    ],
                    "outputs": [
                    ]
                },
                {
                    "name": "renderHelloWorld",
                    "inputs": [
                    ],
                    "outputs": [
                        {"name":"value0","type":"bytes"}
                    ]
                },
                {
                    "name": "touch",
                    "inputs": [
                    ],
                    "outputs": [
                    ]
                },
                {
                    "name": "getTimestamp",
                    "inputs": [
                    ],
                    "outputs": [
                        {"name":"value0","type":"uint256"}
                    ]
                },
                {
                    "name": "sendValue",
                    "inputs": [
                        {"name":"dest","type":"address"},
                        {"name":"amount","type":"uint128"},
                        {"name":"bounce","type":"bool"}
                    ],
                    "outputs": [
                    ]
                },
                {
                    "name": "timestamp",
                    "inputs": [
                    ],
                    "outputs": [
                        {"name":"timestamp","type":"uint32"}
                    ]
                }
            ],
            "data": [
            ],
            "events": [
            ]
        },
        tvc: "te6ccgECGQEAAtgAAgE0AwEBAcACAEPQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgBCSK7VMg4wMgwP/jAiDA/uMC8gsWBQQYApAh2zzTAAGOEoECANcYIPkBWPhCIPhl+RDyqN7TPwH4QyG58rQg+COBA+iogggbd0CgufK0+GPTHwH4I7zyudMfAds8+Edu8nwJBgE6ItDXCwOpOADcIccA3CHXDR/yvCHdAds8+Edu8nwGAiggghBU1r0Yu+MCIIIQaLVfP7vjAgsHAiggghBoF+U1uuMCIIIQaLVfP7rjAgoIAlgw+EJu4wD4RvJzf/hm0fhC8uBl+EUgbpIwcN74Qrry4Gb4APgj+GrbPH/4ZwkTAUrtRNDXScIBio4acO1E0PQFcPhqgED0DvK91wv/+GJw+GNw+GbiFQFSMNHbPPhKIY4cjQRwAAAAAAAAAAAAAAAAOgX5TWDIzssfyXD7AN5/+GcVBFAgghAfnWSDuuMCIIIQNzEuRbrjAiCCEDtj1H664wIgghBU1r0YuuMCEhEPDAJsMNHbPCGOJyPQ0wH6QDAxyM+HIM6NBAAAAAAAAAAAAAAAAA1Na9GIzxbMyXD7AJEw4uMAf/hnDRMBAogOABRoZWxsb1dvcmxkA1Yw+EJu4wD6QZXU0dD6QN/XDX+V1NHQ03/f1wwAldTR0NIA39HbPOMAf/hnFRATAFT4RSBukjBw3vhCuvLgZvgAVHEgyM+FgMoAc89AzgH6AoBrz0DJcPsAXwMCJDD4Qm7jANH4APgj+GrbPH/4ZxUTA3gw+EJu4wDR2zwhjigj0NMB+kAwMcjPhyDOjQQAAAAAAAAAAAAAAAAJ+dZIOM8Wy//JcPsAkTDi4wB/+GcVFBMAKPhK+Eb4Q/hCyMv/yz/KAMsfye1UAAT4SgAo7UTQ0//TP9IA0x/R+Gr4Zvhj+GICCvSkIPShGBcAFnNvbCAwLjQ2LjANAAA=",
    }
}

run()