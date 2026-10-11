import path from "node:path";
import { pathToFileURL } from "node:url";

function endpoint(value) {
    try {
        return new URL(value).href.replace(/\/+$/, "");
    } catch {
        return "";
    }
}

try {
    const [root, id] = process.argv.slice(2);
    let selectedEndpoint = '';
    for await (const chunk of process.stdin) {
        selectedEndpoint += chunk;
        if (selectedEndpoint.length > 4096) throw new Error();
    }
    const sdkPath = path.join(root, "@earendil-works/pi-coding-agent/dist/index.js");
    const { ModelRuntime } = await import(pathToFileURL(sdkPath).href);
    const runtime = await ModelRuntime.create({
        credentials: { read: async () => undefined, list: async () => [] },
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    if (runtime.getError()) throw new Error();
    const models = runtime.getModels().filter(model => model.id === id && model.api === "openai-completions" && endpoint(model.baseUrl) === endpoint(selectedEndpoint));
    if (models.length !== 1) throw new Error();
    const model = models[0];
    const { contextWindow, maxTokens, reasoning } = model;
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > contextWindow) throw new Error();
    if (typeof reasoning !== 'boolean') throw new Error();
    let efforts = ['absent'];
    if (reasoning) {
        const { getSupportedThinkingLevels } = await import(import.meta.resolve('@earendil-works/pi-ai/compat', pathToFileURL(sdkPath).href));
        efforts = getSupportedThinkingLevels(model);
        if (!efforts.length) throw new Error();
    }
    process.stdout.write(JSON.stringify({ provider: model.provider, contextWindow, maxTokens, reasoning, efforts }) + "\n");
} catch {
    process.exitCode = 1;
}
