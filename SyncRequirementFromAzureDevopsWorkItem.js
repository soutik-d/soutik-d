const PulseSdk = require("@qasymphony/pulse-sdk");
const request = require("request");
const xml2js = require("xml2js");

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event, constants, triggers }, context, callback) {
    function buildRequirementDescription(eventData) {
        const fields = getFields(eventData);
        return `<a href="${eventData.resource._links.html.href}" target="_blank">Open in Azure DevOps</a><br>
<b>Type:</b> ${fields["System.WorkItemType"]}<br>
<b>Area:</b> ${fields["System.AreaPath"]}<br>
<b>Iteration:</b> ${fields["System.IterationPath"]}<br>
<b>Description:</b> ${fields["System.Description"]}<br>
<b>Acceptance Criteria:</b> ${fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || ""}`;
    }
    
    function buildRequirementName(namePrefix, eventData) {
        const fields = getFields(eventData);
        return `${namePrefix}${fields["System.Title"]}`;
    }
   
    function buildRequirementStoryPoints(eventData) {
        const fields = getFields(eventData);
        return `${fields["Microsoft.VSTS.Scheduling.StoryPoints"]}`;
    }
	function buildAzureFeatureId(eventData)
	{
		 const fields = getFields(eventData);
        return `${fields["System.Parent"]}`;
	}
    function getFields(eventData) {
        // In case of update the fields can be taken from the revision, in case of create from the resource directly
        return eventData.resource.revision ? eventData.resource.revision.fields : eventData.resource.fields;
    }
    async function getQtestAuthToken()
	{
		const url=`https://sdtest.qtestnet.com/oauth/token`;
		const requestBody=`grant_type:password&username:jovanispy@anuefa.com&password:abc12345`;
		let failed=false;
		let authDet=undefined;
		try{
			const response = await doqTestPostAuthRequest(url, "POST", requestBody);
			console.log("Auth API Response :",JSON.stringify(response));
            if (!response || response.length === 0) {
                console.log("[Info] Response Unavailable.");
				failed = 1;
            } else {
                if (response.length === 1) {
                    authDet = response;
                } else {
                    failed = 2;
                    console.log("[Warn] Multiple Authorization found.");
                }
            }
        } catch (error) {
            console.log("[Error] Failed to get Authorization", error);
            failed = error;
        }
        return { failed: failed, authDet: authDet };
	}
	
	//const qTestTokenDetails=await getQtestAuthToken();
	//console.log("Qtest Token Details :",JSON.stringify(qTestTokenDetails));
	//let qTestToken=undefined;
	//if (qTestTokenDetails.failed)
	//{
	//	qTestToken=`${qTestTokenDetails.failed}`;
	//}
	//else
	//{
	//	qTestToken=qTestTokenDetails.access_token;
    //}
	const standardHeaders = {
        "Content-Type": "application/json",
        Authorization: `bearer ${constants.QTEST_TOKEN}`,
    };
    const eventType = {
        CREATED: "workitem.created",
        UPDATED: "workitem.updated",
        DELETED: "workitem.deleted",
    };
	
	let returnedModuleDetails=undefined;
	
    let workItemId = undefined;
    let requirementToUpdate = undefined;
	const reqAzureFeatureId=buildAzureFeatureId(event);
	let prefixAzFeature=undefined;
	let returnedModuleId=undefined;
    switch (event.eventType) {
        case eventType.CREATED: {
            workItemId = event.resource.id;
 
			prefixAzFeature=`WI${reqAzureFeatureId}`;
			const modURL=`https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/modules?search=${prefixAzFeature}`;
			const moddet1=await searchQtestModuleByAzureFeatureId(modURL);
			const moddetString=JSON.stringify(moddet1)
			//console.log("Returned Module String: ", moddetString);
			const splString=moddetString.split(",");
			const modIdSplit=splString[2].split(":");
			//console.log("String After split",modIdSplit[1]);
			returnedModuleId=modIdSplit[1];
			console.log("Returned Module ID",returnedModuleId);
			
            break;
        }
        case eventType.UPDATED: {
            workItemId = event.resource.workItemId;
            console.log(`[Info] Update workitem event received for 'WI${workItemId}'`);
            const getReqResult = await getRequirementByWorkItemId(workItemId);
            if (getReqResult.failed) {
                return;
            }
            if (getReqResult.requirement === undefined && !constants.AllowCreationOnUpdate) {
                console.log("[Info] Creation of Requirement on update event not enabled. Exiting.");
                return;
            }
            requirementToUpdate = getReqResult.requirement;
            break;
        }
        case eventType.DELETED: {
            workItemId = event.resource.id;
            console.log(`[Info] Delete workitem event received for 'WI${workItemId}'`);
            const getReqResult = await getRequirementByWorkItemId(workItemId);
            if (getReqResult.failed) {
                return;
            }
            if (getReqResult.requirement === undefined) {
                console.log(`[Info] Requirement not found to delete. Exiting.`);
                return;
            }
            // Delete requirement and finish
            await deleteRequirement(getReqResult.requirement);
            return;
        }
        default:
            console.log(`[Error] Unknown workitem event type '${event.eventType}' for 'WI${workitemId}'`);
            return;
    }
	
    // Prepare data to create/update requirement
    const namePrefix = getNamePrefix(workItemId);
    const requirementDescription = buildRequirementDescription(event);
    const requirementName = buildRequirementName(namePrefix, event);
	const reqAzureStoryId= getAzStoryId(workItemId);
	const reqAzureStoryPoints=buildRequirementStoryPoints(event);
	
    if (requirementToUpdate) {
        await updateRequirement(requirementToUpdate, requirementName, requirementDescription, reqAzureStoryPoints);
    } else {
        createRequirement(requirementName, requirementDescription, reqAzureStoryId,reqAzureStoryPoints, returnedModuleId);
    }

    function getNamePrefix(workItemId) {
        return `WI${workItemId}: `;
    }
    function getAzStoryId(workItemId) {
        return `${workItemId}`;
    }
    
    async function getRequirementByWorkItemId(workItemId) {
        const prefix = getNamePrefix(workItemId);
        const url = "https://" + constants.ManagerURL + "/api/v3/projects/" + constants.ProjectID + "/search";
        const requestBody = {
            object_type: "requirements",
            fields: ["*"],
            query: "Name ~ '" + prefix + "'",
        };

        console.log(`[Info] Get existing requirement for 'WI${workItemId}'`);
        let failed = false;
        let requirement = undefined;

        try {
            const response = await post(url, requestBody);
            console.log(response);

            if (!response || response.total === 0) {
                console.log("[Info] Requirement not found by work item id.");
            } else {
                if (response.total === 1) {
                    requirement = response.items[0];
                } else {
                    failed = true;
                    console.log("[Warn] Multiple Requirements found by work item id.");
                }
            }
        } catch (error) {
            console.log("[Error] Failed to get requirement by work item id.", error);
            failed = true;
        }
        return { failed: failed, requirement: requirement };
    }
	
	async function searchQtestModuleByAzureFeatureId(prefix) {
        const url =prefix; //`https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/modules?search=${prefix}`;
        const response = await doRequest(url, "GET", null);
        console.log(response);
        return response;      
    }
	
    async function updateRequirement(requirementToUpdate, name, description, storyPoints) {
        const requirementId = requirementToUpdate.id;
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements/${requirementId}`;
		
        const requestBody = {
            properties: [
                {
                    field_id: constants.RequirementDescriptionFieldID,
                    field_value: description,
                },
                {
                    field_id: constants.AzureStoryPointsFieldId,
                    field_value: storyPoints,
                }
				
            ],
        };

        console.log(`[Info] Updating requirement '${requirementId}'.`);

        try {
            await put(url, requestBody);
            console.log(`[Info] Requirement '${requirementId}' updated.`);
        } catch (error) {
            console.log(`[Error] Failed to update requirement '${requirementId}'.`, error);
        }
    }

    async function createRequirement(name, description, azureStoryId, azureStoryPoints, patModule) {
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements`;
		//const desc=`${qTestToken}`;
		const requestBody = {
            name: name,
            parent_id: patModule, 
            properties: [
                {
                    field_id: constants.RequirementDescriptionFieldID,
                    field_value: description,
                },
				{
					field_id: constants.AzureStoryIdFieldId,
					field_value: azureStoryId,
				},
				{
					field_id: constants.AzureStoryPointsFieldId,
					field_value: azureStoryPoints,
				},
                {
                    field_id: constants.CTEDetailsFieldId,
                    field_value: `https://app.powerbi.com/groups/me/reports/2e3c07cf-8aea-4e0c-ac2a-40661d0771df/ReportSection2e319d649be4649a65b1?chromeless=1&filter=Requirements%2FId%20eq%20%27RQ-18%27`,
                },
            ],
        };

        console.log(`[Info] Creating requirement.`);

        try {
            const response= await post(url, requestBody);
            console.log(`[Info] Requirement created.`);
        } catch (error) {
            console.log(`[Error] Failed to create requirement`, error);
        }
    }

    async function deleteRequirement(requirementToDelete) {
        const requirementId = requirementToDelete.id;
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements/${requirementId}`;

        console.log(`[Info] Deleting requirement '${requirementId}'.`);

        try {
            await doRequest(url, "DELETE", null);
            console.log(`[Info] Requirement '${requirementId}' deleted.`);
        } catch (error) {
            console.log(`[Error] Failed to delete requirement '${requirementId}'.`, error);
        }
    }

    function post(url, requestBody) {
        return doRequest(url, "POST", requestBody);
    }

    function put(url, requestBody) {
        return doRequest(url, "PUT", requestBody);
    }
	function postAuth(url, requestBody)
	{
		return doqTestPostAuthRequest(url, "POST", requestBody);
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
	async function doqTestGetRequest(url, method, requestBody) {
        const qTestHeaders = {
            "Content-Type": "application/json",
            Authorization: `bearer ${constants.QTEST_TOKEN}`,
        };
        const opts = {
            url: url,
            json: true,
            headers: qTestHeaders,
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
	async function doqTestPostAuthRequest(url, method, requestBody) {
        const qTestAuthHeaders = {  
			 "Content-Type": "application/x-www-form-urlencoded",
			  Authorization: `basic ${constants.QTEST_bAuth_TOKEN}`,
        };
        const opts = {
            url: url,
			json: true,
            headers: qTestAuthHeaders,
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
