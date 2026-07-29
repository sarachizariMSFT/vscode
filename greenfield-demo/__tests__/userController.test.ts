import { handleGetUserProfile } from '../src/controllers/userController';

test('handleGetUserProfile returns a known profile', async () => {
	const profile = await handleGetUserProfile('2');
	expect(profile).toEqual({ id: '2', name: 'Grace Hopper' });
});

test('handleGetUserProfile throws for an unknown user', async () => {
	await expect(handleGetUserProfile('999')).rejects.toThrow('not found');
});