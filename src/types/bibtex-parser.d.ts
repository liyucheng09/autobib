declare module 'bibtex-parser' {
    function parseBibTeX(input: string): Record<string, any>;
    export = parseBibTeX;
}