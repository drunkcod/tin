import { describe, it, test, expect } from '@jest/globals';
import { CycleError, TinyContainer } from './index.js';
import { TypeRef } from './typeRef.js';

describe('tin', () => {
	test('register by key', () => {
		const c = new TinyContainer();
		const key = TypeRef.for('key');
		const instance = { message: 'hello' };
		c.register(key, () => instance);

		expect(c.find(key)).toBeTruthy();
		expect(c.get(key)).toEqual(instance);
	});

	it('can register instance', () => {
		const c = new TinyContainer();
		const key = TypeRef.for('key');
		const instance = { message: 'hello' };
		c.registerInstance(key, instance);

		expect({
			first: c.get(key),
			second: c.get(key),
		}).toEqual({
			first: instance,
			second: instance,
		});
	});

	it('reuses instances during resolution', () => {
		const c = new TinyContainer();
		const dep = TypeRef.for('dep');
		const key = TypeRef.for('key');

		let n = 0;
		c.register(dep, () => ({ n: n++ }));
		c.register(key, (c) => ({ x: c.get(dep), y: c.get(dep) }));

		expect(c.get(key)).toMatchObject({ x: { n: 0 }, y: { n: 0 } });
	});

	it('can register singleton scope', () => {
		const c = new TinyContainer();
		const key = TypeRef.for('key');

		let n = 0;
		c.register(key, () => ({ n: n++ }), { scope: 'singleton' });

		expect({ x: c.get(key), y: c.get(key) }).toMatchObject({ x: { n: 0 }, y: { n: 0 } });
	});

	test('singleton can\'t depend on transient', () => {
		const c = new TinyContainer();
		const singleton = TypeRef.for('singleton');
		const transient = TypeRef.for('transient');

		c.register(singleton, (c) => ({ x: c.get(transient) }), { scope: 'singleton' });
		c.register(transient, () => ({ message: 'hello world'}));

		expect(() => c.get(singleton)).toThrowError();
	});

	test('instances are singletons', () => {
		const c = new TinyContainer();
		const singleton = TypeRef.for('singleton');
		const instance = TypeRef.for('instance');

		c.register(singleton, (c) => ({ x: c.get(instance) }), { scope: 'singleton' });
		c.registerInstance(instance, { message: 'hello world'});

		expect(c.get(singleton)).toMatchObject({ x: { message: 'hello world'} });

	});

	it('raises Erorr on resolution failure', () => {
		const c = new TinyContainer();
		const key = TypeRef.for('missing');
		expect(() => c.get(key)).toThrowError();
	});

	it('rasises Error when trying to register a ref twice', () => {
		const c = new TinyContainer();
		const key = TypeRef.for('there-can-be-only-one');
		c.register(key, () => ({ theAnswer: 42 }));
		expect(() => c.register(key, () => ({ message: "nope" }))).toThrowError();

	});
	
	it('detects resolution cycles', () => {
		const c = new TinyContainer();
		const a = TypeRef.for('a');
		const b = TypeRef.for('b');

		c.register(a, (c) => ({ b: c.get(b)}));
		c.register(b, (c) => ({ a: c.get(a)}));
		expect(() => c.get(a)).toThrowError(CycleError);
	});

	it('can create child container', () => {
		const base = new TinyContainer();
		const a = TypeRef.for('a');
		base.register(a, (c) => ({ b: c.get(b)}));
		
		const c = base.child();
		const b = TypeRef.for('b');
		c.register(b, () => ({ value: 'hello' }));

		expect({ 
			a: c.get(a) ,
			baseHasB: base.has(b),
		}).toMatchObject({ 
			a: { b: { value: 'hello' } },
			baseHasB: false,
		});

	});
});
