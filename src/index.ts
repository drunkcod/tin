import { TypeRef } from './typeRef.js';

type TypeKey<T> = { prototype: T } | TypeRef<T>;

type Resolver = Pick<IocContainer, 'get'>;

type FactoryFn<T> = (ioc: Resolver) => T;

export interface IocContainer {
	get<T extends object>(type: TypeKey<T>): T;
	find<T extends object>(type: TypeKey<T>): (ioc: IocContainer) => T;
	has<T extends object>(type: TypeKey<T>): boolean;
	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>): void;
}

const isTypeRef = <T>(x: TypeKey<T>): x is TypeRef<T> => typeof x === 'symbol';

const getSymbolText = (x: Symbol) => {
	const s = x.toString();
	return s.substring('Symbol('.length, s.length - 1);
};

class ResolutionError extends Error {
	readonly key: string;
	constructor(key: string) {
		super(`Resolution failed for "${key}".`);
		this.key = key;
	}
}

const protoToRef = new Map<any, TypeRef<unknown>>();

const getTypeRef = <T extends object>(type: TypeKey<T>): TypeRef<T> => {
	if (isTypeRef(type)) return type;
	const { prototype } = type;
	const found = protoToRef.get(prototype);
	if (found) return found;
	const s = TypeRef.for(prototype.constructor.name);
	protoToRef.set(prototype, s);

	return s;
};

export class SimpleIoc implements IocContainer {
	readonly #knownTypes = new Map<TypeRef<unknown>, FactoryFn<unknown>>();

	find<T extends object>(type: TypeKey<T>): FactoryFn<T> {
		return this.#knownTypes.get(getTypeRef(type)) as FactoryFn<T>;
	}

	get<T extends object>(type: TypeKey<T>): T {
		return new ScopedLookup(this).get(type);
	}

	has<T extends object>(type: TypeKey<T>): boolean {
		const found = this.find(type);
		return !!found;
	}

	register<T extends object, U extends T>(type: TypeKey<T>, ctor: (ioc: Resolver) => U, options?: { scope: undefined | 'singleton' }) {
		const ref = getTypeRef(type);
		if(this.has(ref)) throw new Error(`Can\'t register ${getSymbolText(ref)} twice.`)
		if(options?.scope === 'singleton') {
			let instance: undefined | U = undefined;
			this.#knownTypes.set(ref, () => {
				if(instance === undefined)
					instance = ctor(this);
				return instance;
			})
		} else
			this.#knownTypes.set(ref, ctor);
	}

	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U) {
		this.register(type, () => instance);
	}
}

const CYCLE: unique symbol = Symbol('Dependency Cycle');

export class CycleError extends Error {
	readonly path: TypeRef<unknown>[] = [];

	get message() {
		return `Dependency cycles caused by ${this.path.map(getSymbolText).join('⇢')}.`;
	}
}

class ScopedLookup {
	readonly #resolved = new WeakMap<TypeRef<unknown>, unknown>();
	constructor(private readonly innner: SimpleIoc) {}

	get<T extends object>(type: TypeKey<T>): T {
		const ref = getTypeRef(type);
		try {
			const found = this.#resolved.get(ref);
			if (found !== undefined) {
				if(found == CYCLE)
					throw new CycleError();
				return found as T;
			}

			const resolve = this.innner.find(ref);
			if (!resolve) {
				const name = isTypeRef(type) ? getSymbolText(type) : type.prototype.constructor.name;
				throw new ResolutionError(name);
			}

			this.#resolved.set(ref, CYCLE);
			const resolved = resolve(this);
			this.#resolved.set(ref, resolved);
			return resolved;
		} catch(error) {
			if(error instanceof CycleError)
				error.path.push(ref);
			throw error;
		}
	}
}
