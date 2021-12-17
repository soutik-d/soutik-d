const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event, constants, triggers }, context, callback) {
    const requirementId = event.requirement.id;
    const projectId = event.requirement.project_id;
    //const requirementPID= event.requirement.pid;
    console.log(`[Info] Create requirement event received for requirement '${requirementId}' in project '${projectId}'`);

    if (projectId != constants.ProjectID) {
        console.log(`[Info] Project not matching '${projectId}' != '${constants.ProjectID}', exiting.`);
        return;
    }

    const requirementDetails = await getRequirementDetailsByIdWithRetry(requirementId);
    if (!requirementDetails) return;

	const workItemId = requirementDetails.summary;
    const requirement = await UpdateAzDoRequirement(requirementId, workItemId, requirementDetails.description, requirementDetails.link);
    updateRequirementCTEdetails(requirementId, requirementDetails.link);
    if (!requirement) return;

    function getFieldById(obj, fieldId) {
        if (!obj || !obj.properties) {
            console.log(`[Warn] Obj/properties not found.`);
            return;
        }
        const prop = obj.properties.find((p) => p.field_id == fieldId);
        if (!prop) {
            console.log(`[Warn] Property with field id '${fieldId}' not found.`);
            return;
        }

        return prop;
    }

    async function getRequirementDetailsByIdWithRetry(requirementId) {
        let requirementDetails = undefined;
        let delay = 3000;
        let attempt = 0;
        do {
            if (attempt > 0) {
                console.log(`[Warn] Could not get requirement details on attempt ${attempt}. Waiting ${delay} ms.`);
                await new Promise((r) => setTimeout(r, delay));
                delay *= 3;
            }

            requirementDetails = await getRequirementDetailsById(requirementId);

            if (requirementDetails && requirementDetails.summary && requirementDetails.description) return requirementDetails;

            attempt++;
        } while (attempt < 6);

        console.log(`[Error] Could not get requirement details. Giving up.`);
    }

    async function getRequirementDetailsById(requirementId) {
        const requirement = await getRequirementById(requirementId);

        if (!requirement) return;

        const summaryField =  getFieldById(requirement, constants.AzureStoryIdFieldId);
        const descriptionField = getFieldById(requirement, constants.RequirementDescriptionFieldID);

        if (!summaryField ) {
            console.log("[Error] Fields not found, exiting.");
        }

        const summary = summaryField.field_value;
        const description = descriptionField.field_value;
        const link = requirement.pid;
        return { summary: summary, description: description, link: link };
    }

    async function getRequirementById(requirementId) {
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements/${requirementId}`;

        console.log(`[Info] Get requirement details for '${requirementId}'`);

        try {
            const response = await doqTestRequest(url, "GET", null);
            return response;
        } catch (error) {
            console.log("[Error] Failed to get requirement by id.", error);
        }
    }

    async function UpdateAzDoRequirement(requirementId, witID, description, link) {
        //console.log(`[Info] Creating bug in Azure DevOps '${requirementId}'`);
        const url = encodeURI(`${constants.AzDoProjectURL}/_apis/wit/workitems/${witID}?api-version=6.0`);
        const requestBody = [            
            {
                op: "add",
                path: "/fields/Custom.QtestRequirementID",
                value: link,
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
	async function updateRequirementCTEdetails(requirementId, witID) {
        //const requirementId = requirementToUpdate.id;
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements/${requirementId}`;
        const fval=`https://app.powerbi.com/groups/me/reports/2e3c07cf-8aea-4e0c-ac2a-40661d0771df/ReportSection2e319d649be4649a65b1?chromeless=1&filter=Requirements%2FId%20eq%20%27${witID}%27`;
        const requestBody = {
           
            properties: [
                {
                    field_id: constants.CTEDetailsFieldId,
                    field_value:fval ,
                },
				
            ],
        };

        //console.log(`[Info] Updating requirement '${createdRequirementID}'.`);

        try {
            await put(url, requestBody);
            //console.log(`[Info] Requirement '${createdRequirementID}' updated.`);
        } catch (error) {
            console.log(`[Error] Failed to update requirement.`, error);
        }
    }
	function put(url, requestBody) {
        return doqTestRequest(url, "PUT", requestBody);
    }
    async function doqTestRequest(url, method, requestBody) {
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
