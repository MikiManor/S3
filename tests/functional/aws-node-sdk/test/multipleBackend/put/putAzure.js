const assert = require('assert');
const async = require('async');

const withV4 = require('../../support/withV4');
const BucketUtility = require('../../../lib/utility/bucket-util');
const { getAzureClient, getAzureContainerName, getKeysForTestingAzure } =
  require('../utils');
const { config } = require('../../../../../../lib/Config');

const azureLocation = 'azuretest';
const azureClient = getAzureClient();
const azureContainerName = getAzureContainerName();

const keyName = `somekey-${Date.now()}`;
const normalBody = Buffer.from('I am a body', 'utf8');
const normalMD5 = 'be747eb4b75517bf6b3cf7c5fbb62f3a';

const describeSkipIfNotMultiple = (config.backends.data !== 'multiple'
    || process.env.S3_END_TO_END) ? describe.skip : describe;

const keys = getKeysForTestingAzure();
/* eslint-disable camelcase */
const azureMetadata = {
    x_amz_meta_scal_location_constraint: azureLocation,
};
/* eslint-enable camelcase */

const azureTimeout = 10000;
let bucketUtil;
let s3;

// For contentMD5, Azure requires base64 but AWS requires hex, so convert
// from base64 to hex
function convertMD5(contentMD5) {
    return Buffer.from(contentMD5, 'base64').toString('hex');
}

function azureGetCheck(objectKey, azureMD5, azureMetadata, cb) {
    azureClient.getBlobProperties(azureContainerName, objectKey,
    (err, res) => {
        assert.strictEqual(err, null, 'Expected success, got error ' +
        `on call to Azure: ${err}`);
        const resMD5 = convertMD5(res.contentSettings.contentMD5);
        assert.strictEqual(resMD5, azureMD5);
        assert.deepStrictEqual(res.metadata, azureMetadata);
        return cb();
    });
}

describeSkipIfNotMultiple('MultipleBackend put object to AZURE', () => {
    withV4(sigCfg => {
        beforeEach(() => {
            bucketUtil = new BucketUtility('default', sigCfg);
            s3 = bucketUtil.s3;
        });

        afterEach(() => {
            process.stdout.write('Emptying bucket\n');
            return bucketUtil.empty(azureContainerName)
            .then(() => {
                process.stdout.write('Deleting bucket\n');
                return bucketUtil.deleteOne(azureContainerName);
            })
            .catch(err => {
                process.stdout.write(`Error in afterEach: ${err}\n`);
                throw err;
            });
        });
        describe('with bucket location header', () => {
            beforeEach(done =>
              s3.createBucket({ Bucket: azureContainerName,
                  CreateBucketConfiguration: {
                      LocationConstraint: azureLocation,
                  },
            }, done));
            it('should put an object to Azure, with no object location ' +
            'header, based on bucket location', done => {
                const params = {
                    Bucket: azureContainerName,
                    Key: keyName,
                    Body: normalBody,
                };
                async.waterfall([
                    next => s3.putObject(params, err => setTimeout(() =>
                      next(err), azureTimeout)),
                    next => azureGetCheck(keyName, normalMD5, {}, next),
                ], done);
            });
        });

        describe('with no bucket location header', () => {
            beforeEach(() =>
              s3.createBucketAsync({ Bucket: azureContainerName })
                .catch(err => {
                    process.stdout.write(`Error creating bucket: ${err}\n`);
                    throw err;
                }));

            keys.forEach(key => {
                it(`should put a ${key.describe} object to Azure`,
                function itF(done) {
                    this.timeout(250000);
                    const params = {
                        Bucket: azureContainerName,
                        Key: key.name,
                        Metadata: { 'scal-location-constraint': azureLocation },
                        Body: key.body,
                    };
                    s3.putObject(params, err => {
                        assert.equal(err, null, 'Expected success, ' +
                        `got error ${err}`);
                        setTimeout(() =>
                            azureGetCheck(key.name, key.MD5, azureMetadata,
                            () => done()), azureTimeout);
                    });
                });
            });

            it('should put two objects to Azure with same ' +
            'key, and newest object should be returned', done => {
                const params = { Bucket: azureContainerName, Key: keyName,
                    Metadata: { 'scal-location-constraint': azureLocation },
                };
                async.waterfall([
                    next => s3.putObject(params, err => next(err)),
                    next => {
                        params.Body = normalBody;
                        s3.putObject(params, err => setTimeout(() =>
                          next(err), azureTimeout));
                    },
                    next => {
                        setTimeout(() => {
                            azureGetCheck(keyName, normalMD5, azureMetadata,
                             next);
                        }, azureTimeout);
                    },
                ], done);
            });

            it('should put objects with same key to Azure ' +
            'then file, and object should only be present in file', done => {
                const params = {
                    Bucket: azureContainerName,
                    Key: keyName,
                    Body: normalBody,
                    Metadata: { 'scal-location-constraint': azureLocation } };
                async.waterfall([
                    next => s3.putObject(params, err => next(err)),
                    next => {
                        params.Metadata = { 'scal-location-constraint':
                        'file' };
                        s3.putObject(params, err => setTimeout(() =>
                          next(err), azureTimeout));
                    },
                    next => s3.getObject({
                        Bucket: azureContainerName,
                        Key: keyName,
                    }, (err, res) => {
                        assert.equal(err, null, 'Expected success, ' +
                            `got error ${err}`);
                        assert.strictEqual(
                            res.Metadata['scal-location-constraint'],
                            'file');
                        next();
                    }),
                    next => azureClient.getBlobProperties(azureContainerName,
                    keyName, err => {
                        assert.strictEqual(err.code, 'NotFound');
                        next();
                    }),
                ], done);
            });

            it('should put objects with same key to file ' +
            'then Azure, and object should only be present on Azure', done => {
                const params = { Bucket: azureContainerName, Key: keyName,
                    Body: normalBody,
                    Metadata: { 'scal-location-constraint': 'file' } };
                async.waterfall([
                    next => s3.putObject(params, err => next(err)),
                    next => {
                        params.Metadata = {
                            'scal-location-constraint': azureLocation,
                        };
                        s3.putObject(params, err => setTimeout(() =>
                          next(err), azureTimeout));
                    },
                    next => azureGetCheck(keyName, normalMD5, azureMetadata,
                      next),
                ], done);
            });
        });
    });
});
