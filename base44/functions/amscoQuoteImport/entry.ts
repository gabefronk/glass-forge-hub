import {createClientFromRequest} from "npm:@base44/sdk@0.8.46";
import {XMLParser} from "npm:fast-xml-parser@5.11.1";
import {unzipSync} from "npm:fflate@0.8.3";
import {createAmscoXmlParser} from "../../shared/amscoQuoteXml.js";
import {createImportHandler,importRuntime} from "../../shared/amscoQuoteImportService.js";
const service=importRuntime({parseXml:createAmscoXmlParser({XMLParser,unzipSync})});
const handler=createImportHandler({getClient:createClientFromRequest,service});
export default async function(req: Request){const response=await handler(req);response.headers.set("X-AMSCO-Import-Version","xml-4");return response;}
