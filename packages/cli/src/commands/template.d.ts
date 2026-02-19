import { TemplateVariables } from '@versatly/clawvault-core/lib/template-engine.js';
export interface TemplateCommandContext {
    vaultPath?: string;
    cwd?: string;
    builtinDir?: string;
}
export interface TemplateCreateOptions extends TemplateCommandContext {
    title?: string;
    type?: string;
}
export interface TemplateAddOptions extends TemplateCommandContext {
    name: string;
    overwrite?: boolean;
}
export interface TemplateDefinitionInfo {
    name: string;
    primitive: string;
    description?: string;
    fields: string[];
    path: string;
    format: 'schema' | 'legacy';
}
export declare function listTemplateDefinitions(options?: TemplateCommandContext): TemplateDefinitionInfo[];
export declare function listTemplates(options?: TemplateCommandContext): string[];
export declare function createFromTemplate(name: string, options?: TemplateCreateOptions): {
    outputPath: string;
    templatePath: string;
    variables: TemplateVariables;
};
export declare function addTemplate(file: string, options: TemplateAddOptions): {
    templatePath: string;
    name: string;
};
//# sourceMappingURL=template.d.ts.map