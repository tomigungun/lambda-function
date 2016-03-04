'use strict';

var async = require('async');
var AWS = require('aws-sdk');
AWS.config.region = 'ap-northeast-1';

exports.handler = function(event, context) {
	var tagKey = event.tagKey;
	var deviceName = event.deviceName;
	var generation = event.generation;

	var ec2 = new AWS.EC2();

	async.waterfall([
		function describeTargetInstances(callback) {
			console.log('Start describe target instances.');
			ec2.describeInstances({
				Filters: [{
					Name: 'tag-key',
					Values: [ tagKey ]
				}]
			}, function(err, data) {
				if (err) {
					console.log('Error: ' + err);
					callback(err);
				} else {
					callback(null, data);
				}
			});
		},
		function createSnapshots(response, callback) {
			console.log('Start create snapshots.');
			var descriptions = [];
			async.eachSeries(response.Reservations,
				function(r, done) {
					var instance = r.Instances[0];
					var blockDeviceMappings = instance.BlockDeviceMappings;
					async.eachSeries(blockDeviceMappings,
						function(b, done) {
							if (b.DeviceName == deviceName) {
								var volumeId = b.Ebs.VolumeId;
								var description = 'EBS Backup: InstanceID=' + instance.InstanceId + ', VolumeID=' + volumeId;
								ec2.createSnapshot({
									VolumeId: volumeId,
									Description: description
								}, function(err, data) {
									if (err) {
										console.log('Error: ' + err);
										callback(err);
									} else {
										console.log('Create snapshot: description=' + description);
										descriptions.push(description);
										done();
									}
								});
							} else {
								done();
							}
						},
						function(err) {
							if (err) {
								console.log('Error: ' + err);
								callback(err);
							}
							done();
						}
					);
				},
				function(err) {
					if (err) {
						console.log('Error: ' + err);
						callback(err);
					}
					callback(null, descriptions);
				}
			);
		},
		function describeSnapshots(descriptions, callback) {
			console.log('Start describe snapshots.');
			console.log('descriptions: ' + descriptions);
			var targetSnapshotIds = [];
			
			async.eachSeries(descriptions, 
				function(description, done) {
					ec2.describeSnapshots({
						Filters: [{
							Name: 'description',
							Values: [ description ]
						}]
					}, function(err, data) {
						if (err) {
							console.log('Error: ' + err);
							callback(err);
						} else {
							var snapshots = data.Snapshots;
							if (snapshots.length > generation) {
								snapshots.sort(function(a, b) {
									return Date.parse(a.StartTime) - Date.parse(b.StartTime);
								});
								targetSnapshotIds.push(snapshots[0].SnapshotId);
							}
							done();
						}
					});
				},
				function(err) {
					if (err) {
						console.log('Error: ' + err);
						callback(err);
					}
					if (targetSnapshotIds.length > 0) {
						callback(null, targetSnapshotIds);
					} else {
						context.done(null, 'Success!');
					}
				}
			);
		},
		function deleteOldSnapshots(snapshotIds, callback) {
			console.log('Start delete old snapshots.');
			console.log('snapshotIds: ' + snapshotIds);

			async.eachSeries(snapshotIds,
				function(snapshotId, done) {
					ec2.deleteSnapshot({
						SnapshotId: snapshotId
					}, function(err, data) {
						if (err) {
							console.log('Error: ' + err);
							callback(err);
						} else {
							console.log('Delete snapshot: snapshotId=' + snapshotId);
							done();
						}
					});
				},
				function(err) {
					if (err) {
						console.log('Error: ' + err);
						callback(err);
					}
					callback(null);
				}
			);
		}
	], function (err) {
		if (err) {
			console.log('Error: ' + err);
			context.fail(err);
		} else {
			context.done(null, 'Success!');
		}
	});
};

