const axios = require('axios');
const Promise = require('bluebird');
const http = require('http');
const https = require('https');
const { curry } = require('ramda');

const TENANT_FROM = '';
const TENANT_TO = '';
const src = {
    tenantId: TENANT_FROM,
    url: `http://${TENANT_FROM}.davra.com`,
    authHeader: 'Basic YWRtaW46YWRtaW4=', // admin:admin 
};

const dst = {
    tenantId: TENANT_TO,
    url: `http://${TENANT_TO}.davra.com`,
    authHeader: 'Basic YWRtaW46YWRtaW4=', // admin:admin
};

const HTTP_KEEP_ALIVE_AGENT = new http.Agent({
    keepAlive: true,
    maxSockets: 10,
  });
const HTTPS_KEEP_ALIVE_AGENT = new https.Agent({
    keepAlive: true,
  });
const srcCli = axios.create({
    baseURL: src.url,
    httpAgent: HTTP_KEEP_ALIVE_AGENT,
    httpsAgent: HTTPS_KEEP_ALIVE_AGENT,
    headers: { 'Authorization': src.authHeader }
});
const dstCli = axios.create({
    baseURL: dst.url,
    httpAgent: HTTP_KEEP_ALIVE_AGENT,
    httpsAgent: HTTPS_KEEP_ALIVE_AGENT,
    headers: { 'Authorization': dst.authHeader }
});

const getMetrics = async (cli) => {
    const { data: { fields } } = await cli.get('/api/v1/iotdata/meta-data/metrics');
    // console.log(fields);
    return fields;
};
const getTwinTypes = async (cli) => {
    const { data: types } = await cli.get('/api/v1/twinTypes');
    // console.log(types);
    return types;
};
const getTwins = async (cli) => {
    const { data } = await cli.get('/api/v1/twins');
    // console.log(data);
    return data;
};
const getRules = async (cli) => {
    const { data } = await cli.get('/api/v1/rulesengine');
    // console.log(data);
    return data;
};

const errors = {};
const saveData = curry(async (url, cli, data) => {
    try {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return await cli.post(url, data);
    } catch(e) {
        if (!errors[url]) {
            errors[url] = [];
        }
        errors[url].push(data);
        return e;
    }
})

const saveTwinType = saveData('/api/v1/twinTypes');
const saveTwin = saveData('/api/v1/twins');
const saveDevice = saveData('/api/v1/devices');
const saveUser = saveData('/api/v2/users');
const saveRole = saveData('/api/v1/authorization/roles');
const saveMetric = saveData('/api/v1/iotdata/meta-data');
const saveRule = saveData('/api/v1/rulesengine');

const getUsers = async (cli) => {
    const { data: users } = await cli.get('/api/v2/users?type=USER');
    // console.log(users);
    return users;
};
const getRoles = async (cli) => {
    const { data: roles } = await cli.get('/api/v1/authorization/roles');
    // console.log(roles);
    return roles;
};
const getDevices = async (cli) => {
    const { data: { records } } = await cli.get('/api/v1/devices');
    // console.log(records)
    return records;
};
const migrateTwinTypes = async (userMap) => {
    const ogTwinTypes = await getTwinTypes(srcCli);
    await Promise.map(
        ogTwinTypes
            .filter(({ name }) => name !== 'stateful_incident')
            .map(({ _id, UUID, owner, created, ...t}) => ({
                ...t,
                owner: userMap[owner] ? userMap[owner].UUID : owner,
            })),
        saveTwinType(dstCli),
        { concurrency: 1 },
    );
    const newTwinTypes = await getTwinTypes(dstCli);
    return ogTwinTypes.reduce((ts, t) => ({
        ...ts,
        [t.UUID]: newTwinTypes.find(({ name }) => name === t.name),
    }), {});
}
const migrateTwins = async (userMap, ttMap, dMap) => {
    const ogTwins = await getTwins(srcCli);
    await Promise.map(
        ogTwins
            .map(({ _id, UUID, owner, createdTime, digitalTwinType, labels, ...t}) => ({
                ...t,
                owner: userMap[owner].UUID,
                digitalTwinType: ttMap[digitalTwinType]? ttMap[digitalTwinType].UUID : digitalTwinType,
                labels: Object.keys(labels).reduce((ls, l) => ({
                    ...ls,
                    [l]: dMap[labels[l]] ? dMap[labels[l]].UUID : labels[l]
                }), {})
            })),
        saveTwin(dstCli),
        { concurrency: 1 },
    );
    const newTwins = await getTwins(dstCli);
    return ogTwins.reduce((ts, t) => ({
        ...ts,
        [t.UUID]: newTwins.find(({ name }) => name === t.name),
    }), {});
}
const migrateDevices = async (userMap) => {
    const ogDevices = await getDevices(srcCli);
    await Promise.map(
        ogDevices
            .map(({ _id, owner, modifiedTime, createdTime, tenantId, ...d}) => ({
                ...d,
                owner: userMap[owner] ? userMap[owner].UUID : owner,
            })),
        saveDevice(dstCli),
        { concurrency: 1 },
    );
    const newDevices = await getDevices(dstCli);
    return ogDevices.reduce((devs, d) => ({
        ...devs,
        [d.UUID]: newDevices.find(({ name }) => name === d.name),
    }), {});
}

const migrateUsers = async (roleMap) => {
    const ogUsers = await getUsers(srcCli);
    await Promise.map(
        ogUsers
            .filter(({ name }) => name !== 'admin' && name !== 'operator')
            .map(({ _id, UUID, modifiedTime, creationTime, owner, tenantId, tenants, ...u}) => ({
                ...u,
                roles: u.roles.map(uuid => roleMap[uuid] ? roleMap[uuid].UUID : uuid),
                password: 'Password01!'
            })),
        saveUser(dstCli),
        { concurrency: 1 },
    );
    const newUsers = await getUsers(dstCli);
    return ogUsers.reduce((users, u) => ({
        ...users,
        [u.UUID]: newUsers.find(({ name }) => name === u.name),
    }), {});
};
const migrateRoles = async () => {
    const ogRoles = await getRoles(srcCli);
    await Promise.map(
        ogRoles
            .filter(({ name }) => !['__defaultDeviceRole', 'Administrator', 'Operator'].includes(name))
            .map(({ _id, UUID, modifiedTime, creationTime, owner, tenantId, ...u}) => u),
        saveRole(dstCli),
        { concurrency: 1 },
    );
    const newRoles= await getRoles(dstCli);
    return ogRoles.reduce((roles, role) => ({
        ...roles,
        [role.UUID]: newRoles.find(({ name }) => name === role.name),
    }), {});
};
const migrateMetrics = async () => {
    const ogMetrics = await getMetrics(srcCli);
    await Promise.map(
        ogMetrics
            .map(({ _id, ...m}) => m),
        saveMetric(dstCli),
        { concurrency: 1 },
    );
};
const migrateRules = async (userMap) => {
    const ogRules = await getRules(srcCli);
    await Promise.map(
        ogRules
            .map(({ _id, createdByUuid, owner, ...r}) => ({
                ...r,
                owner: userMap[owner] ? userMap[owner].UUID : owner,
                createdByUuid: userMap[createdByUuid] ? userMap[createdByUuid].UUID : createdByUuid,
            })),
        saveRule(dstCli),
        { concurrency: 1 },
    );
};

const migrate = async () => {
    console.log('Migrating metrics');
    await migrateMetrics();
    console.log('Done')
    console.log('Migrating roles');
    const roleMap = await migrateRoles();
    console.log('Done')
    console.log('Migrating users');
    const userMap = await migrateUsers(roleMap);
    console.log('Done')
    console.log('Migrating devices');
    const deviceMap = await migrateDevices(userMap);
    console.log('Done')
    console.log('Migrating twin types');
    const twinTypeMap = await migrateTwinTypes(userMap);
    console.log('Done')
    console.log('Migrating twin twins');
    const twinMap = await migrateTwins(userMap, twinTypeMap, deviceMap);
    console.log('Done')
    console.log('Migrating rules');
    await migrateRules(userMap);
    console.log('Done')

    console.log('errors', JSON.stringify(errors));
    console.log('Finished migrating tenants, microservices, oauth clients, files, applications, and anything not listed above need to be migrated manually.');
    console.log('Migrated rules could need some manual intervention to work as expected.');
}

migrate();