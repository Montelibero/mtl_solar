import React from "react"
import SubmissionProgress, { SubmissionType } from "../components/SubmissionProgress"

export default { title: "SubmissionProgress" }
export const Pending = () => (
  <SubmissionProgress type={SubmissionType.default} promise={new Promise(resolve => undefined)} />
)
export const Success = () => <SubmissionProgress type={SubmissionType.default} promise={Promise.resolve()} />
export const SuccessMultiSig = () => <SubmissionProgress type={SubmissionType.multisig} promise={Promise.resolve()} />
export const SuccessStellarguard = () => (
  <SubmissionProgress type={SubmissionType.thirdParty} promise={Promise.resolve()} />
)
export const Failed = () => (
  <SubmissionProgress type={SubmissionType.default} promise={Promise.reject(new Error("Test error"))} />
)
export const FailedWithRetry = () => (
  <SubmissionProgress
    type={SubmissionType.default}
    promise={Promise.reject(new Error("Test error"))}
    onRetry={() => Promise.resolve()}
  />
)
