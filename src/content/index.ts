import { bootstrapEditorIntegration } from './editor/bootstrap';
import { bootstrapFunctionSearch } from './functions/bootstrap';
import './editor/indent-guides.css';
import '../syntax/syntax-highlighting.css';
import '../themes/themes.css';
import '../themes/zoho-theme-mapping.css';
import '../themes/zoho-theme-overrides.css';

void bootstrapEditorIntegration();
void bootstrapFunctionSearch();
