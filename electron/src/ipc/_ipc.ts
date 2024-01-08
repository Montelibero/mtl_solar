import { ipcMain } from "electron"
import pick from "lodash.pick"

type ErrorType = { __extraProps: any; message: string; name: string; stack: string }

export function expose<Message extends keyof IPC.MessageType>(
  messageType: Message,
  handler: (
    ...args: IPC.MessageArgs<Message>
  ) => IPC.MessageReturnType<Message> | Promise<IPC.MessageReturnType<Message>>
) {
  ipcMain.on(messageType, async (event: Electron.IpcMainEvent, payload: ElectronIPCCallMessage<Message>) => {
    const { args, callID } = payload
    try {
      const result = await handler(...args)
      event.sender.send(messageType, { callID, result })
    } catch (e) {
      const error: ErrorType = e as ErrorType
      const extras = pick(error, error.__extraProps || [])
      event.sender.send(messageType, {
        callID,
        error: {
          ...extras,
          __extraProps: error.__extraProps,
          message: error.message,
          name: error.name || "Error",
          stack: error.stack
        }
      })
    }
  })
}
