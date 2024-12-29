import { TypeRef } from './typeRef.js';

export { TypeRef, ref } from './typeRef.js';

export type TypeKey<T> = { prototype: T } | TypeRef<T>;

export interface IocContainer {
	get<T extends object>(type: TypeKey<T>): T;
	has<T extends object>(type: TypeKey<T>): boolean;
	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>,  options?: RegistrationOptions): void;
	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U, options?: Pick<RegistrationOptions, 'replace'>): void;
}

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

	static throw(ref: TypeRef<unknown>): never {
		throw new ResolutionError(getSymbolText(ref));
	}
}

type Resolver = Pick<IocContainer, 'get'>;

type Finder = Pick<TinyContainer, 'find'>;

type FactoryFn<T> = (ioc: Resolver) => T;

type Unref<T> = T extends TypeRef<infer U> ? U : never;

type Resolved<T> = {[K in keyof T]: Unref<T[K]> }

type RegistrationOptions = { scope?: Scope, replace?: boolean };

const DefaultOptions = Object.freeze({ scope: 'transient', replace: false });

const isTypeRef = <T>(x: TypeKey<T>): x is TypeRef<T> => typeof x === 'symbol';

const getSymbolText = (x: Symbol) => {
	const s = x.toString();
	return s.substring('Symbol('.length, s.length - 1);
};

const CYCLE: unique symbol = Symbol('Dependency Cycle');

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

const getOne = <T extends object>(ioc: Finder, x: TypeKey<T>, resolved: WeakMap<TypeRef<unknown>, unknown>): T => {
	const ref = getTypeRef(x);
	const [scope, resolve] = ioc.find(ref) ?? ResolutionError.throw(ref);
	return new ScopedLookup(ioc, scope, resolved).resolve(ref, resolve);
}

export class TinyContainer implements IocContainer {
	readonly #knownTypes = new Map<TypeRef<unknown>, [Scope, FactoryFn<unknown>]>();

	#set(key: TypeKey<object>, scope: Scope, ctor: FactoryFn<unknown>, options: { replace: boolean }) {
		const ref = getTypeRef(key);
		if(!options.replace && this.has(ref)) throw new Error(`Can\'t register ${getSymbolText(ref)} twice. If you intended to replace pass { replace: true }.`)
		this.#knownTypes.set(ref, [scope, ctor]);
	}

	child(): IocContainer {
		return new ChildContainer(this);
	}

	find<T extends object>(ref: TypeRef<T>): [Scope, FactoryFn<T>, object] | undefined {
		const found = this.#knownTypes.get(ref) as [Scope, FactoryFn<T>];
		if(found) return [...found, this];
		return undefined;
	}

	get<T extends object>(type: TypeKey<T>): T;
	get<T extends TypeKey<unknown>[]>(types: [...T]): Resolved<T>;
	get(x: TypeKey<object> | TypeKey<object>[]): object | object[] {
		const resolved = new WeakMap<TypeRef<unknown>, unknown>();

		if(Array.isArray(x)) {
			return x.map((r) => getOne(this, r, resolved), this);
		} else {
			return getOne(this, x, resolved);
		}
	}

	has<T extends object>(type: TypeKey<T>): boolean {
		const found = this.find(getTypeRef(type));
		return !!found;
	}

	register<T extends object, U extends T>(type: TypeKey<T>, ctor: FactoryFn<U>, options?: RegistrationOptions) {
		const o = { ...DefaultOptions, ...options };
		if(o.scope === 'singleton') {
			let instance: undefined | U = undefined;
			this.#set(type, 'singleton', (resolver) => {
				if(instance === undefined)
					instance = ctor(resolver);
				return instance;
			}, o);
		} else
			this.#set(type, 'transient', ctor, o);
	}

	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U, options?: Pick<RegistrationOptions, 'replace'>) {
		const o = { ...DefaultOptions, ...options };
		this.#set(type, 'singleton', () => instance, o);
	}
}

class ChildContainer implements IocContainer {
	readonly c = new TinyContainer();
	constructor(private readonly inner: TinyContainer) {}

	get<T extends object>(type: TypeKey<T>): T {
		const resolved = new WeakMap<TypeRef<unknown>, unknown>();
		return getOne(this, type, resolved);
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

	registerInstance<T extends object, U extends T>(type: TypeKey<T>, instance: U): void {
		this.c.registerInstance(type, instance);
	}
}

class ScopedLookup {
	constructor(
		private readonly inner: Pick<TinyContainer, 'find'>,
		private readonly scope: Scope,
		private readonly resolved: WeakMap<TypeRef<unknown>, unknown>) {}

	get<T extends object>(type: TypeKey<T>): T {
		const ref = getTypeRef(type);
		const found = this.resolved.get(ref);
		if (found !== undefined) {
			if(found == CYCLE) {
				const e  = new CycleError();
				e.path.push(ref);
				throw e;
			}
			return found as T;
		}

		const [scope, resolve, other] = this.inner.find(ref) ?? ResolutionError.throw(ref);
		if(this.scope === 'singleton' && (scope !== 'singleton' || this.inner !== other)) 
			throw new ResolutionError('Scope error, singleton instantiated using transient or cross container service.');

		return this.resolve(ref, resolve);
	}

	resolve<T extends object>(ref: TypeRef<T>, resolve: FactoryFn<T>): T {
		this.resolved.set(ref, CYCLE);
		try {
			const resolved = resolve(this);
			this.resolved.set(ref, resolved);
			return resolved;
		} catch(error) {
			if(error instanceof CycleError)
				error.path.push(ref);
			throw error;
		}
	}
}
