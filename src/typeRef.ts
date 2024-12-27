//used to carry type information only.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Ref<T> = { [REF]: 'ref' };

export type TypeRef<T> = Ref<T> & Symbol;

const REF: unique symbol = Symbol();

const _ref = { [REF]: 'ref' };

export const ref = <T>() => _ref as Ref<T>;

export const TypeRef = {
	for<T>(id: string) {
		return Symbol(id) as unknown as TypeRef<T>;
	},
	map<T extends object>(refs: T) {
		type MakeRef<R> = R extends Ref<infer T> ? TypeRef<T> : never;
		type TypeRefs<T> = { [K in keyof T]: MakeRef<T[K]> };
		const r: { [key: string]: TypeRef<unknown> } = {};
		for (const [key, ref] of Object.entries(refs)) {
			if (REF in ref) r[key] = TypeRef.for<unknown>(key);
		}
		return r as TypeRefs<typeof refs>;
	},
};
