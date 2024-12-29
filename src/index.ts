import { TypeRef } from './typeRef.js';

export { TypeRef, ref } from './typeRef.js';
export type TypeKey<T> = { prototype: T } | TypeRef<T>;

type Resolver = Pick<IocContainer, 'get'>;

type FactoryFn<T> = (ioc: Resolver) => T;

export interface IocContainer {
	get<T extends object>(type: TypeKey<T>): T;
	has<T extends object>(type: TypeKey<T>): boolean;
	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>,  options?: { scope: undefined | 'singleton' }): void;
	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U): void;
}

const isTypeRef = <T>(x: TypeKey<T>): x is TypeRef<T> => typeof x === 'symbol';

const getSymbolText = (x: Symbol) => {
	const s = x.toString();
	return s.substring('Symbol('.length, s.length - 1);
};

const CYCLE: unique symbol = Symbol('Dependency Cycle');

export class CycleError extends Error {
	readonly path: TypeRef<unknown>[] = [];

	get message() {
		return `Dependency cycles caused by ${this.path.map(getSymbolText).join('⇢')}.`;
	}
}

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

type Scope = 'transient' | 'singleton';

export class TinyContainer implements IocContainer {
	readonly #knownTypes = new Map<TypeRef<unknown>, [Scope, FactoryFn<unknown>]>();

	#set(key: TypeKey<object>, scope: Scope, ctor: FactoryFn<unknown>) {
		const ref = getTypeRef(key);
		if(this.has(ref)) throw new Error(`Can\'t register ${getSymbolText(ref)} twice.`)
		this.#knownTypes.set(ref, [scope, ctor]);
	}

	child(): IocContainer {
		return new ChildContainer(this);
	}

	find<T extends object>(ref: TypeRef<T>): [Scope, FactoryFn<T>] {
		return this.#knownTypes.get(ref) as [Scope, FactoryFn<T>];
	}

	get<T extends object>(type: TypeKey<T>): T {
		const ref = getTypeRef(type);
		const [scope] = this.find(ref);
		return new ScopedLookup(this, scope ?? 'transient').resolve(ref);
	}

	has<T extends object>(type: TypeKey<T>): boolean {
		const found = this.find(getTypeRef(type));
		return !!found;
	}

	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>, options?: { scope: undefined | 'singleton' }) {
		if(options?.scope === 'singleton') {
			let instance: undefined | U = undefined;
			this.#set(type, 'singleton', (resolver) => {
				if(instance === undefined)
					instance = ctor(resolver);
				return instance;
			});
		} else
			this.#set(type, 'transient', ctor);
	}

	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U) {
		this.#set(type, 'singleton', () => instance);
	}
}

class ChildContainer implements IocContainer {
	readonly c = new TinyContainer();
	constructor(private readonly inner: TinyContainer) {}

	get<T extends object>(type: TypeKey<T>): T {
		return TinyContainer.prototype.get.call(this, type) as T;
	}

	find<T extends object>(type: TypeKey<T>) {
		const ref = getTypeRef(type);
		return this.c.find(ref) ?? this.inner.find(ref);
	}

	has<T extends object>(type: TypeKey<T>): boolean {
		return this.c.has(type) || this.inner.has(type);
	}

	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>, options?: { scope: undefined | 'singleton' }): void {
		this.c.register(type, ctor, options);
	}

	registerInstance<T extends object, U extends T>(
		type: { prototype: T } | TypeRef<T>,
		instance: U,
	): void {
		this.c.registerInstance(type, instance);
	}
}

class ScopedLookup {
	readonly #resolved = new WeakMap<TypeRef<unknown>, unknown>();
	constructor(
		private readonly innner: Pick<TinyContainer, 'find'>,
		private readonly scope: Scope) {}

	get<T extends object>(type: TypeKey<T>): T {
		const ref = getTypeRef(type);
		const found = this.#resolved.get(ref);
		if (found !== undefined) {
			if(found == CYCLE) {
				const e  = new CycleError();
				e.path.push(ref);
				throw e;
			}
			return found as T;
		}

		return this.resolve(ref);
	}

	resolve<T extends object>(ref: TypeRef<T>): T {
		const [scope, resolve] = this.innner.find(ref);
		if (!resolve) throw new ResolutionError(getSymbolText(ref));

		if(this.scope === 'singleton' && scope !== 'singleton') 
			throw new ResolutionError('Scope error, singleton instantieted using transient service.');

		this.#resolved.set(ref, CYCLE);
		try {
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
