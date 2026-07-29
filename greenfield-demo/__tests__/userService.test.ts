import { deleteUser, getUser, getUserProfile } from '../src/services/userService';

test('getUser returns a known user', async () => {
	const user = await getUser('1');
	expect(user.name).toBe('Ada Lovelace');
});

test('getUser throws for an unknown user', async () => {
	await expect(getUser('999')).rejects.toThrow('not found');
});

test('getUserProfile returns a known user profile', async () => {
	const profile = await getUserProfile('2');
	expect(profile).toEqual({ id: '2', name: 'Grace Hopper' });
});

test('getUserProfile throws for an unknown user', async () => {
	await expect(getUserProfile('999')).rejects.toThrow('not found');
});

test('deleteUser removes and returns a known user', async () => {
	const deletedUser = await deleteUser('1');
	expect(deletedUser.name).toBe('Ada Lovelace');
	await expect(getUser('1')).rejects.toThrow('not found');
});
