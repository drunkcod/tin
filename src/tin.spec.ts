import { describe, it, test, expect } from '@jest/globals';
import { SimpleIoc } from './index.js';
import { TypeRef } from './typeRef.js';

describe('tin', () => {
	test('register by key', () => {
		const c = new SimpleIoc();
		const key = TypeRef.for('key');
		const instance = { message: 'hello' };
		c.register(key, () => instance);

		expect(c.find(key)).toBeTruthy();
		expect(c.get(key)).toEqual(instance);
	});

	it('can register instance', () => {
		const c = new SimpleIoc();
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
		const c = new SimpleIoc();
		const dep = TypeRef.for('dep');
		const key = TypeRef.for('key');

		let n = 0;
		c.register(dep, () => ({ n: n++ }));
		c.register(key, (c) => ({ x: c.get(dep), y: c.get(dep) }));

		expect(c.get(key)).toMatchObject({ x: { n: 0 }, y: { n: 0 } });
	});

	it('raises Erorr on resolution failure', () => {
		const c = new SimpleIoc();
		const key = TypeRef.for('missing');
		expect(() => c.get(key)).toThrowError();
	});
});
