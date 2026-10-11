import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ModelRuntime = {
    async create(options) {
        const location = options.modelsPath ?? path.join(process.env.PI_CODING_AGENT_DIR, 'models.json');
        const data = JSON.parse(await readFile(location, 'utf8'));
        const models = Object.entries(data.providers).flatMap(([provider, config]) =>
            config.models.map(model => ({ ...config, ...model, provider })));
        return {
            getError: () => undefined,
            getModels: () => models,
            getModel: (provider, id) => models.find(model => model.provider === provider && model.id === id),
        };
    },
};
