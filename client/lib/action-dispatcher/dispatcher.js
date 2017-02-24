// @flow
import { GenericBinaryVoting } from '/client/lib/ethereum/contracts'
import Company from '/client/lib/ethereum/deployed'

import Identity from '/client/lib/identity'

import Queue from '/client/lib/queue'

import { bylawForAction } from './bylaws'
import actions from './actions'

const gasEstimate = p => {
  return new Promise((resolve, reject) => {
    web3.eth.estimateGas(p, (err, gas) => resolve(err ? -1 : gas))
  })
}

const sendTransaction = p => {
  return new Promise((resolve, reject) => {
    web3.eth.sendTransaction(p, (err, txid) => {
      if (err) return reject(err)
      resolve(txid)
    })
  })
}

const promisedDeploy = (c, p) => {
  let counter = 0 // Counter needed because contract deploy returns twice, one with txhash and later w txhash & address
  return new Promise((resolve, reject) => {
    c.new.apply(c, p.concat([(err, x) => {
      if (counter > 0) return 0
      if (err) return reject(err)
      counter += 1
      resolve(x.transactionHash)
    }]))
  })
}

class Dispatcher {
  get address() {
    return Identity.current(true).ethereumAddress
  }

  get transactionParams() {
    return { from: this.address }
  }

  async dispatch(action, ...params) {
    const bylaw = bylawForAction(action)
    if (bylaw.type === 0) {
      return await this.createVoting(action.companyFunction, params,
                                      action.signature, bylaw.details.minimumVotingTime)
    }

    return await this.performTransaction(action.companyFunction, params)
  }

  async performTransaction(f, args) {
    const [ params ] = f.request.apply(this, args.concat([this.transactionParams])).params
    params.from = this.address
    const txID = await sendTransaction(params)
    await this.addPendingTransaction(txID)
  }

  async signPayload(payload: string) {
    return await new Promise((resolve, reject) => {
      web3.eth.sign(this.address, payload, (e, signature) => {
        if (e) return reject(e)

        const r = signature.slice(0, 66)
        const s = `0x${signature.slice(66, 130)}`
        const v = `0x${signature.slice(130, 132)}` // Assumes v = { 27, 28 }
        resolve({ r, s, v })
      })
    })
  }

  async deployContract(contract, ...args) {
    if (args.length < 1) return reject(new Error("No params for contract deployment provided"))
    args[args.length-1].data = contract.binary // Last arg is transaction params, so we add the contract binary data

    const txID = await promisedDeploy(web3.eth.contract(contract.abi), args)
    await this.addPendingTransaction(txID)
  }

  async addPendingTransaction(txID: String) {
    await Queue.add(txID)
  }

  async createVoting(f: Function, args: Array<mixed>, signature: string, votingTime: number) {
    const txData = f.request.apply(this, args).params[0].data
    const votingCloses = votingTime + Math.floor(+new Date() / 1000)

    const company = Company()
    /*
    // TODO: This needs to be used again
    const votesOnCreate = true
    const executesOnDecided = false
    */

    const nonce = parseInt(Math.random() * 1e15)
    const payload = await company.sigPayload(nonce)
    const { r, s, v } = await this.signPayload(payload)

    const txid = await this.deployContract(GenericBinaryVoting, txData, votingCloses, company.address, r, s, v, nonce, this.transactionParams)
    console.log('deployed on tx', txid)
  }
}

export default new Dispatcher()
