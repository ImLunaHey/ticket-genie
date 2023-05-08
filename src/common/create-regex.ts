export const createRegex = (phrase: string): RegExp => new RegExp(`(${phrase})\\s+(?<uuid>[a-fA-F0-9-]+)\\s+(?<json_args>{.*}|undefined)`);
