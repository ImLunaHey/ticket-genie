export const generateInputString = <T>(phrase: string, uuid: string, jsonArgs?: T): string => {
    const jsonArgsString = JSON.stringify(jsonArgs);
    return `${phrase} ${uuid} ${jsonArgsString}`;
};