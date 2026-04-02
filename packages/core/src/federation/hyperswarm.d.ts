declare module 'hyperswarm' {
  import { EventEmitter } from 'events';

  interface HyperswarmOptions {
    maxPeers?: number;
  }

  interface Discovery {
    flushed(): Promise<void>;
  }

  class Hyperswarm extends EventEmitter {
    constructor(options?: HyperswarmOptions);
    join(topic: Buffer, options?: { server?: boolean; client?: boolean }): Discovery;
    destroy(): Promise<void>;
  }

  export default Hyperswarm;
}
