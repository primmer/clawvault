interface LinkOptions {
    all?: boolean;
    dryRun?: boolean;
}
declare function linkCommand(file: string | undefined, options: LinkOptions): Promise<void>;

export { linkCommand };
