import {createClientFromRequest} from "npm:@base44/sdk@0.8.46";
import {XMLParser} from "npm:fast-xml-parser@5.11.1";
import {unzipSync} from "npm:fflate@0.8.3";
import {createAmscoXmlParser} from "../../shared/amscoQuoteXml.js";
import {createImportHandler,importRuntime} from "../../shared/amscoQuoteImportService.js";
export default createImportHandler({getClient:createClientFromRequest,service:importRuntime({parseXml:createAmscoXmlParser({XMLParser,unzipSync})}),agent:false});
