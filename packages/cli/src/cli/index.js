import { registerContextCommand } from '../commands/context.js';
import { registerInjectCommand } from '../commands/inject.js';
import { registerObserveCommand } from '../commands/observe.js';
import { registerReflectCommand } from '../commands/reflect.js';
import { registerEmbedCommand } from '../commands/embed.js';
import { registerReweaveCommand } from '../commands/reweave.js';
export function registerCliCommands(program) {
    registerContextCommand(program);
    registerInjectCommand(program);
    registerObserveCommand(program);
    registerReflectCommand(program);
    registerEmbedCommand(program);
    registerReweaveCommand(program);
    return program;
}
//# sourceMappingURL=index.js.map