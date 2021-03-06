import {
  SlaveProcess,
  LoadProjectResponse,
  PrevStateResponse,
  DirectStateTransitionResponse,
  GetSymbolsResponse,
  GetMetadataResponse,
  GetDataResponse,
  ToggleLibsResponse
} from './../helpers/process';
import { ipcMain } from 'electron';
import { Message, Status } from '../../shared/ipc-constants';
import { State } from '../states/state';
import { Config } from '../../shared/data-format';
import { menus } from '../app';
import { join } from 'path';

const success = (sender, msg, payload) => {
  sender.send(msg, Status.Success, payload);
};

const error = (sender, msg, payload) => {
  sender.send(msg, Status.Failure, payload);
};

interface Task {
  (): Promise<void>;
}

class TaskQueue {
  private queue: Task[] = [];

  push(task: Task) {
    this.queue.unshift(task);
    if (this.queue.length === 1) {
      this.next();
    }
  }

  private next() {
    const task = this.queue.pop();
    if (task) {
      task().then(() => this.next(), () => this.next());
    }
  }
}

export class BackgroundApp {
  private states: State[] = [];
  private slaveProcess: SlaveProcess;
  private taskQueue: TaskQueue;

  init(config: Partial<Config>) {
    this.slaveProcess = SlaveProcess.create(join(__dirname, 'parser.js'));
    this.taskQueue = new TaskQueue();

    ipcMain.on(Message.Config, e => {
      success(e.sender, Message.Config, config);
    });

    ipcMain.on(Message.LoadProject, (e, { tsconfig, showLibs }: { tsconfig: string; showLibs: boolean }) => {
      if (!this.slaveProcess.connected) {
        console.log('The slave process is not ready yet');
      } else {
        console.log('The slave process is connected');
      }
      console.log('Loading project. Forwarding message to the background process.');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.LoadProject,
            tsconfig,
            showLibs
          })
          .then((data: LoadProjectResponse) => {
            if (data.err) {
              console.log('Got error message while loading the project: ', data.err);
              error(e.sender, Message.LoadProject, data.err);
            } else {
              console.log('The project was successfully loaded');
              success(e.sender, Message.LoadProject, null);
            }
          });
      });
    });

    ipcMain.on(Message.PrevState, e => {
      console.log('Requesting previous state');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.PrevState
          })
          .then((data: PrevStateResponse) => {
            console.log('Got previous state');
            if (data.available) {
              success(e.sender, Message.PrevState, data.available);
            } else {
              error(e.sender, Message.PrevState, data.available);
            }
          });
      });
    });

    ipcMain.on(Message.DirectStateTransition, (e, id: string) => {
      console.log('Requesting direct state transition');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.DirectStateTransition,
            id
          })
          .then((data: DirectStateTransitionResponse) => {
            console.log('Got response for direct state transition', id, data.available);
            if (data.available) {
              success(e.sender, Message.DirectStateTransition, data.available);
            } else {
              error(e.sender, Message.DirectStateTransition, data.available);
            }
          });
      });
    });

    ipcMain.on(Message.GetSymbols, e => {
      console.log('Requesting symbols...');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.GetSymbols
          })
          .then((data: GetSymbolsResponse) => {
            console.log('Got symbols response');
            if (data.symbols) {
              success(e.sender, Message.GetSymbols, data.symbols);
            }
          });
      });
    });

    ipcMain.on(Message.GetMetadata, (e, id: string) => {
      console.log('Requesting metadata...');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.GetMetadata,
            id
          })
          .then((response: GetMetadataResponse) => {
            console.log('Got metadata from the child process');
            if (response.data) {
              success(e.sender, Message.GetMetadata, response.data);
            } else {
              error(e.sender, Message.GetMetadata, null);
            }
          });
      });
    });

    ipcMain.on(Message.GetData, e => {
      console.log('Requesting data');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.GetData
          })
          .then((response: GetDataResponse) => {
            console.log('Got data response', response.data);
            if (response.data) {
              success(e.sender, Message.GetData, response.data);
            } else {
              error(e.sender, Message.GetData, null);
            }
          });
      });
    });

    ipcMain.on(Message.ToggleLibs, e => {
      console.log('Toggle libs!');
      this.taskQueue.push(() => {
        return this.slaveProcess
          .send({
            topic: Message.ToggleLibs
          })
          .then(() => {
            console.log('The slave process toggled the libs');
            success(e.sender, Message.ToggleLibs, true);
          });
      });
    });

    ipcMain.on(Message.DisableExport, e => {
      (menus.items[0] as any).submenu.items[1].enabled = false;
      success(e.sender, Message.DisableExport, true);
    });

    ipcMain.on(Message.EnableExport, e => {
      (menus.items[0] as any).submenu.items[1].enabled = true;
      console.log('Enable!');
      success(e.sender, Message.EnableExport, true);
    });
  }

  get state(): State | undefined {
    return this.states[this.states.length - 1];
  }
}
