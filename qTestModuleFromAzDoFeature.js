const PulseSdk = require("@qasymphony/pulse-sdk");
const request = require("request");
const xml2js = require("xml2js");

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event, constants, triggers }, context, callback) {
    
    
    function buildModuleName(namePrefix, eventData) {
        const fields = getFields(eventData);
        return `${namePrefix}${fields["System.Title"]}`;
    }
   
    
    function getFields(eventData) {
        // In case of update the fields can be taken from the revision, in case of create from the resource directly
        return eventData.resource.revision ? eventData.resource.revision.fields : eventData.resource.fields;
    }

    const standardHeaders = {
        "Content-Type": "application/json",
        Authorization: `bearer ${constants.QTEST_TOKEN}`,
    };
    const eventType = {
        CREATED: "workitem.created",
       // UPDATED: "workitem.updated",
       // DELETED: "workitem.deleted",
    };

    let workItemId = undefined;
    switch (event.eventType) {
        case eventType.CREATED: {
            workItemId = event.resource.id;
            console.log(`[Info] Create workitem event received for 'WI${workItemId}'`);
            break;
        }
        
        default:
            console.log(`[Error] Unknown workitem event type '${event.eventType}' for 'WI${workitemId}'`);
            return;
    }

    // Prepare data to create/update requirement
    const namePrefix = getNamePrefix(workItemId);
    const moduleName = buildModuleName(namePrefix, event);
   
    const module=await createModule(moduleName);
	const modUp=await UpdateAzDoModuleId(workItemId, module.pid);
    
    function getNamePrefix(workItemId) {
        return `WI${workItemId}: `;
    }
      
    async function createModule(name) {
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/modules`;
        const requestBody = {
            name: name
            
        };

        console.log(`[Info] Creating Module.`);

        try {
            const response= await post(url, requestBody);
            return response;
        } catch (error) {
            console.log(`[Error] Failed to create requirement`, error);
        }
    }
	
	async function UpdateAzDoModuleId(witID, qTestModPID) {
        //console.log(`[Info] Creating bug in Azure DevOps '${requirementId}'`);
        const url = encodeURI(`${constants.AzDoProjectURL}/_apis/wit/workitems/${witID}?api-version=6.0`);
        const requestBody = [            
            {
                op: "add",
                path: "/fields/Custom.qTestModuleID",
                value: qTestModPID,
            },
        ];
        try {
            const bug = await doAzDoRequest(url, "PATCH", requestBody);
            console.log(`[Info] Bug created in Azure DevOps`);
            return bug;
        } catch (error) {
            console.log(`[Error] Failed to create bug in Azure DevOps: ${error}`);
        }
    }

    function post(url, requestBody) {
        return doRequest(url, "POST", requestBody);
    }

    function put(url, requestBody) {
        return doRequest(url, "PUT", requestBody);
    }

    async function doRequest(url, method, requestBody) {
        const opts = {
            url: url,
            json: true,
            headers: standardHeaders,
            body: requestBody,
            method: method,
        };

        return new Promise((resolve, reject) => {
            request(opts, function (error, response, body) {
                if (error) {
                    reject(error);
                    return;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(`HTTP ${response.statusCode}`);
                    return;
                }

                resolve(body);
            });
        });
    }
	async function doAzDoRequest(url, method, requestBody) {
        const basicToken = Buffer.from(`:${constants.AZDO_TOKEN}`).toString("base64");

        const opts = {
            url: url,
            json: true,
            headers: {
                "Content-Type": "application/json-patch+json",
                Authorization: `basic ${basicToken}`,
            },
            body: requestBody,
            method: method,
        };

        return new Promise((resolve, reject) => {
            request(opts, function (error, response, body) {
                if (error) {
                    reject(error);
                    return;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(`HTTP ${response.statusCode}`);
                    return;
                }

                resolve(body);
            });
        });
    }
};
