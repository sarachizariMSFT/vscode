// Repository layer — data access only.
export interface User {
	id: string;
	name: string;
}

export interface UserProfile {
	id: string;
	name: string;
}

const users: Record<string, User> = {
	'1': { id: '1', name: 'Ada Lovelace' },
	'2': { id: '2', name: 'Grace Hopper' },
};

export async function findUser(id: string): Promise<User | undefined> {
	return users[id];
}

export async function findUserProfile(id: string): Promise<UserProfile | undefined> {
	const user = users[id];
	if (!user) {
		return undefined;
	}
	return { id: user.id, name: user.name };
}

export async function removeUser(id: string): Promise<void> {
	delete users[id];
}
