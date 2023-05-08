import { createRegex } from '@app/common/create-regex';

type MyObject<T = Record<string, unknown>> = {
    phrase: string;
    uuid: string;
    json_args: T;
};

export const parseCustomId = <T>(phrase: string, input: string): MyObject<T> => {
    const match = input.match(createRegex(phrase));
    if (!match) throw new Error(`This is used in the wrong button, looking in "${input}" for "${phrase}".`);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { uuid, json_args } = match.groups!;
    const parsedJson = json_args === 'undefined' ? undefined as T : JSON.parse(json_args) as T;
    return {
        phrase,
        uuid,
        json_args: parsedJson,
    };
};
