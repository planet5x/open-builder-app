import type localforage from "localforage";

type LocalForageInstance = ReturnType<typeof localforage.createInstance>;

export function createLocalforageStorage(instance: LocalForageInstance) {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const value = await instance.getItem<string>(name);
      return value ?? null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await instance.setItem(name, value);
    },
    removeItem: async (name: string): Promise<void> => {
      await instance.removeItem(name);
    },
  };
}
