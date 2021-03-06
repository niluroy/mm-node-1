import GroupDao from './group.dao';
import log from '../../config/log4js.config';
import GroupUserMapDao from '../../apis/group/groupUserMap.dao';
import consultationGroupModel from './index';
import sequelize from '../../util/conn.mysql';
import groupUserMapModel from './index';
import groupModel from './index';
import userModel from '../user/index';
import UserService from '../user/user.service';
import DoctorService from '../doctor/doctor.service';
import visitorAppointmentModel from '../visitor/index';
import MessageService from '../message/message.service';
import AuditModel from '../audit/audit.model';
import AuditService from '../audit/audit.service';
import NotificationService from '../notification/notification.service';
import VisitorService from '../visitor/visitor.service';
import emailConfig from '../../config/email.config';
import messageConfig from '../../config/message.config';
import lodash from 'lodash';

const Promise = require('bluebird');
const moment = require('moment');

const groupDao = new GroupDao();
const groupUserMapDao = new GroupUserMapDao();
const userService = new UserService();
const doctorService = new DoctorService();
const messageService = new MessageService();
const auditService = new AuditService();
const notificationService = new NotificationService();
const visitorService = new VisitorService();

class GroupService {
    constructor() {}

    /**
     * CRUD for group
     */
    create(group, callback) {
        return groupDao.insert(group, (groupCreated) => {
            callback(groupCreated);
        });
    }

    getAll(callback) {
        return groupDao.readAll((allgroups) => {
            callback(allgroups);
        });
    }

    getById(id, callback) {
        return groupDao.readById(id, (groupById) => {
            callback(groupById);
        });
    }

    update(group, callback) {
        groupDao.update(group, (groupUpdated) => {
            callback(groupUpdated);
        });
    }

    delete(id, callback) {
        return groupDao.delete(id, (groupDeleted) => {
            callback(groupDeleted);
        });
    }

    //create group by admin
    async createGroupByAdmin(group, callback) {
        var groupName = await this.getGroupName(group.users);
        var updateName = '';
        groupName.map((name) => {
            if (updateName !== '') { updateName = updateName + ', ' + name; } else { updateName = name; }
        });
        var group = {
            name: updateName,
            url: group.url,
            userId: group.userId,
            details: {
                description: group.description,
                speciality: group.speciality
            },
            picture: group.picture,
            status: group.status,
            phase: group.status,
            createdBy: group.userId,
            updatedBy: group.userId
        };
        return groupDao.insert(group, (groupCreated) => {
            callback(groupCreated);
        });
    }

    //create mapping for the users for newly created group
    mapUsers(users, groupId, callback) {
        users.map((user) => {
            var groupUserMap = {
                groupId: groupId,
                userId: user.id,
                createdBy: user.id,
                updatedBy: user.id
            };
            this.createGroupUserMap(groupUserMap, () => {});
        });
        callback({ message: 'Users mapped successfully.' });
    }

    //updating the group by the admin
    async updateGroup(group, callback) {
        //update the group details by dao and update the mapping of users in consultation_group_user_map
        var groupName = await this.getGroupName(group.users);
        var updateName = '';
        groupName.map((name) => {
            if (updateName !== '') { updateName = updateName + ', ' + name; } else { updateName = name; }
        });
        group.name = updateName;
        groupDao.update(group, (groupUpdated) => {
            callback(groupUpdated);
        });
        var gUMaps = groupModel.consultation_group_user_map.findAll({
            where: {
                groupId: group.id
            }
        });
        var idList = await this.userIds(gUMaps, group.users);
        var remove = lodash.xor(lodash.union(idList.oldList, idList.newList), idList.newList);
        var add = lodash.xor(lodash.union(idList.oldList, idList.newList), idList.oldList);
        var groupUserMap = {
            userId: add,
            groupId: group.id,
            createdBy: add,
            updatedBy: add
        };
        if (add) {
            this.createGroupUserMap(groupUserMap, () => {});
        } else { return; }
        if (remove) {
            this.deleteGroupUserMap(remove, group.id, () => {});
        } else { return; }
    }

    async userIds(gUMaps, users) {
        var oldList = [];
        var newList = [];
        await gUMaps.map((gUMap) => {
            oldList.push(gUMap.userId);
        });
        await users.map((user) => {
            newList.push(user.id);
        });
        return ({ oldList: oldList, newList: newList });
    }

    getGroupName(users) {
        var groupName = '';
        return Promise.map(users, user => {
            return new Promise((resolve, reject) => {
                userService.getById(user.id, (userDetail) => {
                    if (userDetail.role === 'doctor') {
                        groupName = 'Dr ' + userDetail.firstname + ' ' + userDetail.lastname;
                    } else {
                        groupName = userDetail.firstname + ' ' + userDetail.lastname;
                    }
                    resolve(groupName);
                });
            });
        });
    }

    /**
     * CRUD for groupUser
     */
    createGroupUserMap(groupUser, callback) {
        return groupUserMapDao.insert(groupUser, (groupUserMapCreated) => {
            callback(groupUserMapCreated);
        });
    }

    getAllGroupUserMaps(callback) {
        return groupUserMapDao.readAll((allgroupUserMaps) => {
            callback(allgroupUserMaps);
        });
    }

    getGroupUserMapById(id, callback) {
        return groupUserMapDao.readById(id, (groupUserMapById) => {
            callback(groupUserMapById);
        });
    }

    updateGroupUserMap(groupUser, callback) {
        return groupUserMapDao.update(groupUser, (groupUserMapUpdated) => {
            callback(groupUserMapUpdated);
        });
    }

    updateGroupStatus(groupId, status, callback) {
        return sequelize.transaction().then(function(t) {
            consultationGroupModel.consultation_group.update({ status: status }, {
                where: {
                    id: groupId
                }
            }, { transaction: t }).then(function(groupUpdated) {
                callback(groupUpdated);
            }).then(function() {
                t.commit();
            }).catch(function(error) {
                t.rollback();
            });
        });
    }

    deleteGroupUserMap(userId, groupId, callback) {
        return groupUserMapDao.delete(userId, groupId, (groupUserMapDeleted) => {
            callback(groupUserMapDeleted);
        });
    }

    /**
     * fetching all the groups for particular userId from group-user-map
     */
    getAllGroupsByUserId(userId) {
        return new Promise((resolve, reject) => {
            return groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    userId: userId
                }
            }).then((allGroupUserMapByUserId) => {
                return Promise.map(allGroupUserMapByUserId, groupUserMap => {
                    return new Promise((resolve, reject) => {
                        groupModel.consultation_group.findById(groupUserMap.groupId)
                            .then((group) => {
                                resolve(group);
                            }).catch((error) => {
                                reject(error);
                            });
                    });
                    //return groupModel.consultation_group.findById(groupUserMap.groupId);
                }).then((groups) => {
                    userService.getById(userId, (result) => {
                        var activeGroups = [];
                        var inactiveGroups = [];
                        let medhelp = groups.shift();
                        allGroupUserMapByUserId.map((gumap)=>{
                        if(gumap.groupId===medhelp.id){
                            medhelp.dataValues.unreadCount = gumap.unreadCount 
                        }
                        })
                        groups.reverse().map((group) => {
                            if (result.role === 'doctor' && group.name !== 'MedHelp') {
                                var groupName = [];
                                groupName = group.name.split(',');
                                group.name = '';
                                var temp = groupName[0];
                                for (let i = 1; i < groupName.length; i++) {
                                    group.name = group.name + groupName[i];
                                }
                                group.name = group.name + ',' + temp;
                            }
                            let inactiveGroupTime = moment(moment(group.createdAt).utc().format()).add(3, 'd');
                            if (group.phase === 'active') { //MedHelp and all active groups
                                allGroupUserMapByUserId.map((gumap)=>{
                                    if(gumap.groupId===group.id){
                                        group.dataValues.unreadCount = gumap.unreadCount 
                                    }
                                })
                                activeGroups.push(group);
                            } else {
                                if (inactiveGroupTime >= moment()) { //doctor is not active but for some query he will be available
                                    allGroupUserMapByUserId.map((gumap)=>{
                                        if(gumap.groupId===group.id){
                                            group.dataValues.unreadCount = gumap.unreadCount 
                                        }
                                    })
                                    inactiveGroups.push(group);
                                } else if (inactiveGroupTime <= moment() && group.name !== 'MedHelp') {
                                    var updated = {
                                        phase: 'archive',
                                        details: group.details
                                    };
                                    consultationGroupModel.consultation_group.update(updated, {
                                        where: {
                                            id: group.id
                                        }
                                    });
                                } else {
                                    return;
                                }
                            }
                        });
                        activeGroups.unshift(medhelp);
                        resolve({ activeGroups: activeGroups, inactiveGroups: inactiveGroups });
                    });
                }).catch((error) => {
                    reject(error);
                });
            });
        });
    }

    /**
     * archived groups by userId
     */
    getArchivedGroupsByUserId(userId) {
        return new Promise((resolve, reject) => {
            return groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    userId: userId
                }
            }).then((allGroupUserMapByUserId) => {
                return Promise.map(allGroupUserMapByUserId, groupUserMap => {
                    return new Promise((resolve, reject) => {
                        groupModel.consultation_group.findById(groupUserMap.groupId)
                            .then((group) => {
                                resolve(group);
                            }).catch((error) => {
                                reject(error);
                            });
                    });
                }).then((groups) => {
                    var archiveGroups = [];
                    groups.map((group) => {
                        if (group.phase === 'archive') {
                            archiveGroups.push(group);
                        } else {
                            return;
                        }
                    });
                    resolve(archiveGroups);
                }).catch((error) => {
                    reject(error);
                });
            });
        });
    }

    getAllGroupMapsByUserId(userId, callback) {
            groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    userId: userId
                }
            }).then((usermaps) => {
                callback(usermaps);
            })

        }
        //returns all user details in a group taking group id as input
    getAllUsersInGroup(groupId) {
        return new Promise((res, rej) => {
            groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    groupId: groupId
                }
            }).then((users) => {
                return Promise.map(users, (user) => {
                    return new Promise((res, rej) => {
                        userModel.user.findById(user.userId).then((userDetails) => {
                                res(userDetails);
                            })
                            .catch((error) => {
                                rej(error)
                            });
                    });
                }).then((allUsers) => {
                    res(allUsers);
                }).catch((error) => {
                    rej(error)
                });
            });
        });
    }

    /**
     * fetching all the group's status for particular userId
     */
    async getGroupStatus(userId, callback) {
        var groupUserMaps = await groupUserMapModel.consultation_group_user_map.findAll({
            where: {
                userId: userId
            }
        });
        var gUMaps = await this.findUsers(groupUserMaps);
        var groupStatus = await this.findUserStatus(gUMaps, userId);
        var status = [];
        await groupStatus.map((grpStatus) => {
            status.push(this.filterGroups(grpStatus));
        });
        callback(status);
    }

    async findUsers(groupUserMaps) {
        var array = [];
        await groupUserMaps.map((groupUserMap) => {
            array.push(groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    groupId: groupUserMap.groupId
                }
            }));
        });
        return Promise.all(array);
    }

    findUserStatus(gUMaps, userId) {
        return Promise.all(
            gUMaps.map((gUMap) => {
                return Promise.all(gUMap.map((gum => {
                    if (gum.userId !== parseInt(userId)) {
                        return userModel.user.find({
                                where: {
                                    id: gum.userId
                                }
                            })
                            .then((user) => {
                                if (user.status === 'online') {
                                    return groupModel.consultation_group.find({
                                            where: {
                                                id: gum.groupId
                                            }
                                        })
                                        .then((group) => {
                                            return groupModel.consultation_group.update({
                                                    status: 'online'
                                                }, {
                                                    where: {
                                                        id: group.id
                                                    }
                                                })
                                                .then(() => {
                                                    return groupModel.consultation_group.find({
                                                        where: {
                                                            id: group.id
                                                        }
                                                    });
                                                });
                                        });
                                } else {
                                    return;
                                }
                            });
                    } else {
                        return;
                    }
                })));
            })
        );
    }

    filterGroups(groups) {
        var index = -1;
        var arr_length = groups ? groups.length : 0;
        var resIndex = -1;
        var result = [];
        while (++index < arr_length) {
            var group = groups[index];
            if (group) {
                result[++resIndex] = group;
            }
        }
        return result;
    }

    /**
     * getting users one by one based on groupId 
     */
    getUsersByGroupId(groupId, callback) {
        return groupUserMapModel.consultation_group_user_map.findAll({
            where: {
                groupId: groupId
            }
        }).then((allUserIdsByGroupId) => {
            return Promise.map(allUserIdsByGroupId, groupUserMap => {
                return userService.getById(groupUserMap.userId, (res) => {
                    callback(res);
                });
            });
        });
    }

    /**
     * getting all users based on groupId 
     */
    getAllUsersByGroupId(groupId, callback) {
        return groupUserMapModel.consultation_group_user_map.findAll({
            where: {
                groupId: groupId
            }
        }).then((groupUserMaps) => {
            return Promise.map(groupUserMaps, groupUserMap => {
                return new Promise((resolve, reject) => {
                    userService.getById(groupUserMap.userId, (users, err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(users);
                    });
                })
            }).then((groupUsers) => {
                callback(groupUsers);
            });
        });
    }

    /**
     * get groups based on the group url
     */
    getGroupByUrl(url) {
        groupModel.consultation_group.findOne({
            where: {
                url: url
            }
        }).then((group) => {});
    }

    /**
     * group created by bot or doctor
     */
    createGroupAuto(group, receiverId, callback) {
        this.create(group, (createdGroup) => {
            callback(createdGroup);
            groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    groupId: receiverId
                }
            }).then((allGroupUser) => {
                //map bot and user to created group
                for (var i = 0; i < allGroupUser.length; i++) {
                    var groupUserMap = {
                        groupId: createdGroup.id,
                        userId: allGroupUser[i].userId,
                        createdBy: createdGroup.createdBy,
                        updatedBy: createdGroup.updatedBy
                    }
                    this.createGroupUserMap(groupUserMap, (userMapped) => {});
                    userService.getById(allGroupUser[i].userId, (user) => {
                        if (user.role.toLowerCase() == 'bot') {
                            //create audit for this created group
                            var audit = new AuditModel({
                                senderId: user.id,
                                receiverId: createdGroup.id,
                                receiverType: 'group',
                                mode: 'Guided mode',
                                entityName: 'group',
                                entityEvent: 'added',
                                createdBy: user.id,
                                updatedBy: user.id,
                                createdTime: Date.now(),
                                updatedTime: Date.now()
                            });
                            auditService.create(audit, () => {});
                        }
                    });
                }
            });
            sequelize
                .query("select d.id from doctor d LEFT JOIN visitor_appointment va on d.id=va.doctorId where va.doctorId is NULL", {
                    type: sequelize.QueryTypes.SELECT
                })
                .then((allDoctors) => {
                    if (allDoctors.length > 0) { //for new group
                        var doctorMap = { //mapping doctor to consultation
                            patientId: createdGroup.userId,
                            doctorId: allDoctors[0].id,
                            createdBy: createdGroup.createdBy,
                            updatedBy: createdGroup.updatedBy,
                            lastActive: Date.now()
                        }
                        doctorService.createConsultation(doctorMap, (consultationCreated) => {});
                        //mapping doctor to a group
                        var groupDoctorMap = {
                            groupId: createdGroup.id,
                            userId: allDoctors[0].id,
                            createdBy: createdGroup.createdBy,
                            updatedBy: createdGroup.updatedBy
                        }
                        this.createGroupUserMap(groupDoctorMap, (doctorMapped) => {});
                    } else { //for existing doctors
                        visitorAppointmentModel.visitor_appointment.findAll({
                                order: [
                                    ['lastActive', 'ASC']
                                ],
                                limit: 1
                            })
                            .then((allMappedDoctors) => {
                                var doctorMap = {
                                    patientId: createdGroup.userId,
                                    doctorId: allMappedDoctors[0].doctorId,
                                    createdBy: createdGroup.createdBy,
                                    updatedBy: createdGroup.updatedBy,
                                    lastActive: Date.now()
                                }
                                doctorService.createConsultation(doctorMap, (consultationCreated) => {});
                                //mapping doctor to a group
                                var groupDoctorMap = {
                                    groupId: createdGroup.id,
                                    userId: allMappedDoctors[0].doctorId,
                                    createdBy: createdGroup.createdBy,
                                    updatedBy: createdGroup.updatedBy
                                }
                                this.createGroupUserMap(groupDoctorMap, (doctorMapped) => {});
                                //update lastActive for this doctor
                                visitorAppointmentModel.visitor_appointment
                                    .update({
                                        "lastActive": Date.now()
                                    }, {
                                        where: {
                                            doctorId: allMappedDoctors[0].doctorId
                                        }
                                    })
                                    .then((consultationUpdated) => {});
                            });
                    }
                });
        });
    }

    /**
     * create new group manually
     */
    createGroupManual(group, receiverId, doctorId, callback) {
        this.create(group, (createdGroup) => {
            callback(createdGroup);
            groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    groupId: receiverId
                }
            }).then((allGroupUser) => {
                for (var i = 0; i < allGroupUser.length; i++) {
                    var groupUserMap = {
                        groupId: createdGroup.id,
                        userId: allGroupUser[i].userId,
                        createdBy: createdGroup.createdBy,
                        updatedBy: createdGroup.updatedBy
                    }
                    this.createGroupUserMap(groupUserMap, (userMapped) => {});
                    userService.getById(allGroupUser[i].userId, (user) => {
                        if (user.role.toLowerCase() == 'bot') {
                            //create audit for this created group
                            var audit = new AuditModel({
                                senderId: user.id,
                                receiverId: createdGroup.id,
                                receiverType: 'group',
                                mode: 'Guided mode',
                                entityName: 'group',
                                entityEvent: 'added',
                                createdBy: user.id,
                                updatedBy: user.id,
                                createdTime: Date.now(),
                                updatedTime: Date.now()
                            });
                            auditService.create(audit, () => {});
                        }
                    });
                }
            });
            //mapping doctor into consultation
            var doctorMap = {
                patientId: createdGroup.userId,
                doctorId: doctorId,
                createdBy: createdGroup.createdBy,
                updatedBy: createdGroup.updatedBy,
                lastActive: Date.now()
            }
            doctorService.createConsultation(doctorMap, (consultationCreated) => {});
            //mapping doctor to a group
            var groupDoctorMap = {
                groupId: createdGroup.id,
                userId: doctorId,
                createdBy: createdGroup.createdBy,
                updatedBy: createdGroup.updatedBy
            }
            this.createGroupUserMap(groupDoctorMap, (doctorMapped) => {});
        });
    }

    consultNow(doctorId, patientId, speciality, callback) {
            /**
             * Changed the logic to fetch the groups in which doctor and patient is present
             * DoctorId is being stored in the group URL which makes it easy to fetch the group details
             */
            // return sequelize
            //     .query(`
            //     SELECT
            //         *
            //     FROM
            //     consultation_group
            //     WHERE
            //         userId=${patientId}
            //     AND
            //         phase!='archive'
            //     AND
            //         url="consultation/${doctorId}";
            //         `, {
            //         type: sequelize.QueryTypes.SELECT
            //     })
            //     .then((result, err) => {
            //         if (err) {
            //             log.error('Error while fetching doctors list ', err);
            //             callback(err);
            //         } else {
            //             if (result.length >= 1) {
            //                 var existingGroup = result[0];
            //                 callback(existingGroup);
            //                 // mapping doctor to the group
            //                 // var groupUserMap = {
            //                 //     groupId: existingGroup.id,
            //                 //     userId: doctorId,
            //                 //     createdBy: existingGroup.createdBy,
            //                 //     updatedBy: existingGroup.updatedBy
            //                 // };
            //                 // this.createGroupUserMap(groupUserMap, (doctorMapped) => {
            //                 // });
            //                 //create notification for the doctor
            //                 // doctorService.getById(doctorId, (doctor) => {
            //                 //     userService.getById(patientId, (user) => {
            //                 //         var notification = {
            //                 //             userId: doctorId,
            //                 //             type: 'follow up',
            //                 //             title: `Follow up with ${user.firstname} ${user.lastname}`,
            //                 //             content: `Speciality chosen: ${doctor.doctorDetails.speciality}`,
            //                 //             status: 'created',
            //                 //             channel: 'web',
            //                 //             priority: 1,
            //                 //             template: '',
            //                 //             triggerTime: moment().add(2, 'm'),
            //                 //             createdBy: user.id,
            //                 //             updatedBy: user.id
            //                 //         };
            //                 //         notificationService.create(notification, (notificationCreated) => {
            //                 //         });
            //                 //     });
            //                 // });
            //             } else {
            userService.getById(doctorId, (doctor) => { //doctor details from user table
                if (doctor) {
                    var groupName = '';
                    userService.getById(patientId, (user) => {
                        doctorService.getById(doctorId, (result) => { //doctor from doctor table
                            if (result.doctorDetails) {
                                groupName = 'Dr. ' + doctor.firstname + ' ' + doctor.lastname + ', ' + user.firstname + ' ' + user.lastname;
                                var group = {
                                    name: groupName,
                                    url: `consultation/${doctorId}`,
                                    userId: patientId,
                                    doctorId: doctorId,
                                    speciality: speciality,
                                    details: {
                                        description: 'Consultation for registered patients',
                                        speciality: result.doctorDetails.speciality
                                    },
                                    picture: null,
                                    phase: 'inactive',
                                    status: 'online',
                                    createdBy: patientId,
                                    updatedBy: patientId
                                };
                                this.createGroupForConsultation(group, doctorId, patientId, (newGroup) => {
                                    callback(newGroup);
                                    doctorService.updateDoctorSchedule({ status: 'busy' }, doctorId, (statusUpdated) => {
                                        console.log('status updated')
                                    })
                                });
                            }
                        });
                    });
                } else {
                    return;
                }
            });
            // }
        }
        // });
        // }

    createGroupForConsultation(group, doctorId, patientId, callback) {
        this.create(group, (createdGroup) => {
            // mapping patient to the group
            var groupUserMap = {
                groupId: createdGroup.id,
                userId: patientId,
                createdBy: createdGroup.createdBy,
                updatedBy: createdGroup.updatedBy
            };
            this.createGroupUserMap(groupUserMap, (userMapped) => {});
            //mapping bot(same bot which is in MedHelp) to the consutation group and create a new message
            groupUserMapModel.consultation_group_user_map.findAll({
                where: {
                    userId: patientId
                },
                order: [
                    ['createdAt', 'ASC']
                ],
                limit: 1
            }).then((groupUserMap) => {
                this.getById(groupUserMap[0].groupId, (group) => {
                    groupUserMapModel.consultation_group_user_map.findAll({
                        where: {
                            groupId: group.id
                        }
                    }).then((groupUserMaps) => {
                        groupUserMaps.map((groupUserMap) => {
                            userService.getById(groupUserMap.userId, ((user) => {
                                if (user.role.toLowerCase() == 'bot') {
                                    var groupUserMapBot = {
                                        groupId: createdGroup.id,
                                        userId: user.id,
                                        createdBy: user.id,
                                        updatedBy: user.id
                                    };
                                    groupUserMapDao.insert(groupUserMapBot, (createdGroupUserMap) => {});
                                    var msg = {
                                        receiverId: createdGroup.id,
                                        receiverType: 'group',
                                        senderId: user.id,
                                        senderName: user.firstname + ' ' + user.lastname,
                                        text: 'Welcome to Mesomeds! Doctor will join the group in 2-3 minutes',
                                        createdBy: user.id,
                                        updatedBy: user.id,
                                        createdTime: Date.now(),
                                        updatedTime: Date.now()
                                    };
                                    messageService.sendMessage(msg, (result) => {
                                        callback(createdGroup);
                                    });
                                    //create notification for the doctor
                                    doctorService.getById(doctorId, (doctor) => {
                                        if (doctor.doctorDetails.speciality) {
                                            userService.getById(patientId, (user) => {
                                                if (user) {
                                                    var notification = {
                                                        userId: doctorId,
                                                        type: 'consultation',
                                                        title: `Consultation with ${user.firstname} ${user.lastname}`,
                                                        content: {
                                                            speciality: doctor.doctorDetails.speciality,
                                                            consultationId: createdGroup.id
                                                        },
                                                        status: 'created',
                                                        channel: 'web',
                                                        priority: 1,
                                                        template: '',
                                                        triggerTime: moment().add(45, 's'),
                                                        createdBy: user.id,
                                                        updatedBy: user.id
                                                    };
                                                    notificationService.create(notification, (notificationCreated) => {
                                                        if (notificationCreated) {
                                                            console.log(Date.now());
                                                            userService.getById(doctorId, (doctorDetails) => {
                                                                //code for sending notification as email and SMS also
                                                                var emailNotification = {
                                                                    userId: doctorId,
                                                                    type: 'consultation',
                                                                    title: `Consultation with ${user.firstname} ${user.lastname}`,
                                                                    content: {
                                                                        speciality: doctor.doctorDetails.speciality,
                                                                        consultationId: createdGroup.id
                                                                    },
                                                                    status: 'created',
                                                                    channel: 'email',
                                                                    priority: 0,
                                                                    template: {
                                                                        from: "test.arung@gmail.com",
                                                                        to: doctorDetails.email,
                                                                        body: `You have a consultation with ${user.firstname} ${user.lastname} at ${notificationCreated.triggerTime}.`
                                                                    },
                                                                    triggerTime: moment().add(1, 'm'),
                                                                    createdBy: user.id,
                                                                    updatedBy: user.id
                                                                };
                                                                notificationService.create(emailNotification, (emailNotificationCreated) => {
                                                                    emailConfig
                                                                        .send({
                                                                            template: 'notification-doctor',
                                                                            message: {
                                                                                to: 'nilu.kumari@awnics.com' //doctor email
                                                                            },
                                                                            locals: {
                                                                                subject: emailNotificationCreated.title,
                                                                                patientName: user.firstname + ' ' + user.lastname,
                                                                                patientEmail: user.email, //user email id
                                                                                doctorName: 'Dr.' + ' ' + doctorDetails.firstname + ' ' + doctorDetails.lastname,
                                                                                priority: emailNotificationCreated.priority,
                                                                                triggerTime: emailNotificationCreated.triggerTime,
                                                                                type: emailNotificationCreated.type
                                                                            }
                                                                        })
                                                                        .then(res => {
                                                                            log.info('Email sent successfully to doctor for user email id: ' + user.email);
                                                                        })
                                                                        .catch(error =>
                                                                            log.error('Error while sending notification to doctor', error)
                                                                        );
                                                                });
                                                                //for SMS notification message
                                                                userService.sendTextMessage(doctorId, doctorDetails.phoneNo, messageConfig.authkey, messageConfig.country, messageConfig.notificationMessage, doctorDetails.firstname + ' ' + doctorDetails.lastname, 'Message Notification', 'Notification Message sent');
                                                            });
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    });
                                }
                            }));
                        });
                    });
                });
            });
        });
    }

    //we will need this code to review for updating the group status on logout of the user
    async groupStatusUpdate(userId, callback) {
        var groups = await this.getAllGroupsByUserId(userId);
        var count = await this.getStatusCount(groups);
        callback(count);
    }

    getStatusCount(groups) {
        return Promise.all(groups.map((group) => {
            return groupUserMapModel.consultation_group_user_map.findAll({
                    where: {
                        groupId: group.id
                    }
                })
                .then((gUMaps) => {
                    var count = [],
                        i = 0;
                    return Promise.all(gUMaps.map((gUMap) => {
                        return userService.getById(gUMap.userId, (user) => {
                            if (user.status === 'online') {
                                return ++count[i];
                            } else {
                                return;
                            }
                        });
                    }));
                    i = ++i;
                    if (count[0] < 2) {
                        groupService.update({
                            id: group.id,
                            status: 'offline'
                        }, (res) => {});
                    } else {
                        return;
                    }
                });
        }));
    }
}

export default GroupService;