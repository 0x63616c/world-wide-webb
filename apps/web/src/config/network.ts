/**
 * Network tile user configuration.
 *
 * MONTHLY_CAP_GB is the household's monthly data cap in GB. It is USER
 * CONFIGURATION, not a network metric — it cannot be measured from the WAN, so
 * it is set here rather than fetched from the API (which only reports measured
 * values). The Data Budget modal maps the live projected usage against this cap.
 */
export const MONTHLY_CAP_GB = 1024;
