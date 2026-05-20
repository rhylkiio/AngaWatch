// Force Rspack/Webpack to look in the root /js/ folder for chunks
// @ts-ignore
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// The handler takes over all logic and instantiates its own internal engine automatically!
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
    handler.onmessage(msg);
};