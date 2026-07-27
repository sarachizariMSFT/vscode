/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { InferenceEngine } from '../../src/governance/common/inferenceEngine';

describe('InferenceEngine.scanFromPrompt', () => {
	it('returns greenfield defaults for an empty or unrecognized prompt', () => {
		const result = InferenceEngine.scanFromPrompt('');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-tests');
		expect(ids).toContain('infer-no-secrets');
	});

	it('returns greenfield defaults for a generic prompt with no keywords', () => {
		const result = InferenceEngine.scanFromPrompt('help me write some code');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-tests');
		expect(ids).toContain('infer-no-secrets');
	});

	it('detects REST API intent → includes security and input-validation standards', () => {
		const result = InferenceEngine.scanFromPrompt('build a REST API with JWT authentication');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-no-secrets');
		expect(ids).toContain('infer-input-validation');
		expect(ids).toContain('infer-tests');
	});

	it('detects TypeScript/Node intent → includes async-await and package-pinning', () => {
		const result = InferenceEngine.scanFromPrompt('create a Node.js TypeScript project');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-async-await');
		expect(ids).toContain('infer-package-pinning');
	});

	it('detects React/Next.js intent', () => {
		const result = InferenceEngine.scanFromPrompt('build a Next.js app with React');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-async-await');
		expect(ids).toContain('infer-package-pinning');
	});

	it('detects Python intent → includes type-hints standard', () => {
		const result = InferenceEngine.scanFromPrompt('write a FastAPI service in Python');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-type-hints');
		expect(ids).toContain('infer-tests');
	});

	it('detects infrastructure/cloud intent → includes no-hardcoded-creds', () => {
		const result = InferenceEngine.scanFromPrompt('set up Terraform for AWS infrastructure');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-no-hardcoded-creds');
	});

	it('detects explicit testing mention → always includes infer-tests', () => {
		const result = InferenceEngine.scanFromPrompt('write tests for the authentication module');
		const ids = result.map(s => s.id);
		expect(ids).toContain('infer-tests');
	});

	it('never returns duplicate standard ids', () => {
		const result = InferenceEngine.scanFromPrompt('build a REST API with JWT auth in TypeScript with tests');
		const ids = result.map(s => s.id);
		const unique = new Set(ids);
		expect(ids.length).toBe(unique.size);
	});

	it('all returned standards have required fields', () => {
		const result = InferenceEngine.scanFromPrompt('build a Python REST API with Django');
		for (const standard of result) {
			expect(typeof standard.id).toBe('string');
			expect(typeof standard.label).toBe('string');
			expect(typeof standard.evidence).toBe('string');
			expect(typeof standard.enabled).toBe('boolean');
			expect(typeof standard.category).toBe('string');
		}
	});
});
